import { describe, expect, it } from 'vitest'
import type { Chord } from '../types'
import { chordLabel, italianName, plainDegree, prettySymbol } from './chordLabels'

const chord = (symbol: string, roman: string, fn: Chord['function']): Chord => ({
  measure: 1,
  beat: 1,
  symbol,
  roman,
  function: fn
})

describe('chord labels', () => {
  it('names chords in Italian', () => {
    expect(italianName('Gm')).toBe('Solm')
    expect(italianName('C/E')).toBe('Do/Mi')
    expect(italianName('Bbm7b5/F')).toBe('Si♭m7♭5/Fa')
    expect(italianName('F#dim7')).toBe('Fa♯dim7')
    expect(italianName('Eaug')).toBe('Miaum')
  })

  it('prints symbols with real accidentals', () => {
    expect(prettySymbol('Bbmaj7/D')).toBe('B♭maj7/D')
    expect(prettySymbol('C#m')).toBe('C♯m')
  })

  it('reduces roman numerals to the degree', () => {
    expect(plainDegree('iv6')).toBe('iv')
    expect(plainDegree('iiø42')).toBe('iiø')
    expect(plainDegree('ii#642')).toBe('ii')
    expect(plainDegree('V65/V')).toBe('V/V')
    expect(plainDegree('viio7')).toBe('vii°')
    expect(plainDegree('bII6')).toBe('♭II')
  })

  it('labels a chord in every style', () => {
    const c = chord('Gm/Bb', 'iv6', 'predominant')
    expect(chordLabel(c, 'name-degree')).toBe('Solm/Si♭ · iv')
    expect(chordLabel(c, 'names')).toBe('Solm/Si♭')
    expect(chordLabel(c, 'symbols')).toBe('Gm/B♭')
    expect(chordLabel(c, 'functions')).toBe('S')
    expect(chordLabel(c, 'roman')).toBe('iv6')
    expect(chordLabel(chord('F', 'III', 'other'), 'functions')).toBe('Fa')
  })
})
