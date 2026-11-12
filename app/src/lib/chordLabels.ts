/**
 * How a chord of the harmonic analysis is labelled, in the style the user picks:
 * - name-degree: Italian name and plain degree, «Solm · IV»;
 * - names: Italian name, «Solm», «Do/Mi» (the bass after the slash);
 * - symbols: chord symbols as in lead sheets, «Gm», «C/E»;
 * - functions: T (tonica), S (sottodominante), D (dominante);
 * - roman: classical roman numerals with inversion figures, «iv⁶».
 */
import type { Chord } from '../types'

export type ChordLabelStyle = 'name-degree' | 'names' | 'symbols' | 'functions' | 'roman'

export const LABEL_STYLES: { value: ChordLabelStyle; label: string; hint: string }[] = [
  { value: 'name-degree', label: 'Nome e grado', hint: 'Solm · IV: che accordo è e che ruolo ha nella tonalità' },
  { value: 'names', label: 'Nomi (italiano)', hint: 'Rem, Solm, Do/Mi: dopo la barra la nota al basso' },
  { value: 'symbols', label: 'Sigle (Dm, G7)', hint: 'Sigle anglosassoni, come nei fake book: Dm, Gm, C/E' },
  {
    value: 'functions',
    label: 'Funzioni (T S D)',
    hint: 'T tonica (riposo), S sottodominante, D dominante (tensione)'
  },
  {
    value: 'roman',
    label: 'Numeri romani',
    hint: 'Analisi classica: grado, rivolto (⁶, ⁶₄, ⁴₂…) e dominanti secondarie'
  }
]

export const FUNCTION_NAMES = {
  tonic: 'Tonica',
  predominant: 'Sottodominante',
  dominant: 'Dominante',
  other: 'Altro'
} as const

const FUNCTION_LETTERS = { tonic: 'T', predominant: 'S', dominant: 'D', other: '' } as const

const ITALIAN: Record<string, string> = { C: 'Do', D: 'Re', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' }

/** Chord-symbol suffixes (engine harmony.py templates), Italian style. */
const SUFFIX_IT: Record<string, string> = {
  '': '',
  m: 'm',
  dim: 'dim',
  aug: 'aum',
  '7': '7',
  m7: 'm7',
  m7b5: 'm7♭5',
  dim7: 'dim7',
  maj7: 'maj7'
}

const accidental = (s: string) => s.replace(/#/g, '♯').replace(/b/g, '♭')

interface ParsedSymbol {
  root: string
  alter: string
  suffix: string
  bass: string | null
}

function parseSymbol(symbol: string): ParsedSymbol | null {
  const m = /^([A-G])([#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(symbol)
  return m ? { root: m[1], alter: m[2], suffix: m[3], bass: m[4] ?? null } : null
}

function italianNote(name: string): string {
  return ITALIAN[name[0]] + accidental(name.slice(1))
}

/** «Gm/Bb» -> «Solm/Si♭». */
export function italianName(symbol: string): string {
  const p = parseSymbol(symbol)
  if (!p) return symbol
  const suffix = SUFFIX_IT[p.suffix] ?? accidental(p.suffix)
  return italianNote(p.root + p.alter) + suffix + (p.bass ? `/${italianNote(p.bass)}` : '')
}

/** «Bbm7b5/F» -> «B♭m7♭5/F». */
export function prettySymbol(symbol: string): string {
  const p = parseSymbol(symbol)
  if (!p) return symbol
  return (
    p.root + accidental(p.alter) + accidental(p.suffix) + (p.bass ? `/${p.bass[0]}${accidental(p.bass.slice(1))}` : '')
  )
}

/** The degree without inversion figures: «iiø42» -> «iiø», «V65/V» -> «V/V», «viio7» -> «vii°». */
export function plainDegree(roman: string): string {
  const m = /^([b#]*)([ivIV]+)([o+ø]?)[^/]*(\/.+)?$/.exec(roman)
  if (!m) return roman
  const [, acc, numeral, quality, applied = ''] = m
  return accidental(acc) + numeral + quality.replace('o', '°') + applied.replace(/o/g, '°')
}

export function functionLetter(fn: Chord['function']): string {
  return FUNCTION_LETTERS[fn]
}

/** One line of text for a chord (falling notes, tooltips). Roman numerals keep their figures inline. */
export function chordLabel(chord: Chord, style: ChordLabelStyle): string {
  switch (style) {
    case 'names':
      return italianName(chord.symbol)
    case 'symbols':
      return prettySymbol(chord.symbol)
    case 'functions':
      return functionLetter(chord.function) || italianName(chord.symbol)
    case 'roman':
      return accidental(chord.roman).replace(/o/g, '°')
    default:
      return `${italianName(chord.symbol)} · ${plainDegree(chord.roman)}`
  }
}

/** Whether the style is relative to the key (then the key is shown where it starts). */
export function showsKey(style: ChordLabelStyle): boolean {
  return style === 'name-degree' || style === 'roman' || style === 'functions'
}
