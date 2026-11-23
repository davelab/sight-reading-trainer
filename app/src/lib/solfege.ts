/**
 * Solfeggio drill: melodic phrases to read in rhythm, from easy to hard, built
 * from the rhythmic cells every method teaches (with their syllables: ta, ti-ti,
 * ta-i ti, ti-ri-ti-ri...) and melodies that follow the textbook rules: mostly
 * steps, a leap is followed by a step the other way, the phrase ends on the
 * tonic approached from the 2nd or the 7th degree.
 */
import { barsOf, beamsFor, pickupLead, type RhythmNote } from './drills'

export type Random = () => number

/** A rhythmic cell: lengths in quarters (negative = rest), its syllables, the beats it fills. */
export interface Cell {
  id: string
  /** Lengths in quarters; a rest is negative. */
  lengths: number[]
  syllables: string[]
  triplet?: boolean
}

export const CELLS: Record<string, Cell> = {
  ta: { id: 'ta', lengths: [1], syllables: ['ta'] },
  titi: { id: 'titi', lengths: [0.5, 0.5], syllables: ['ti', 'ti'] },
  rest: { id: 'rest', lengths: [-1], syllables: [''] },
  half: { id: 'half', lengths: [2], syllables: ['ta-a'] },
  dottedHalf: { id: 'dottedHalf', lengths: [3], syllables: ['ta-a-a'] },
  dottedQuarter: { id: 'dottedQuarter', lengths: [1.5, 0.5], syllables: ['ta-i', 'ti'] },
  restTi: { id: 'restTi', lengths: [-0.5, 0.5], syllables: ['', 'ti'] },
  tiriTiri: { id: 'tiriTiri', lengths: [0.25, 0.25, 0.25, 0.25], syllables: ['ti', 'ri', 'ti', 'ri'] },
  tiTiri: { id: 'tiTiri', lengths: [0.5, 0.25, 0.25], syllables: ['ti', 'ti', 'ri'] },
  tiriTi: { id: 'tiriTi', lengths: [0.25, 0.25, 0.5], syllables: ['ti', 'ri', 'ti'] },
  syncopation: { id: 'syncopation', lengths: [0.5, 1, 0.5], syllables: ['ti', 'ta', 'ti'] },
  dottedEighth: { id: 'dottedEighth', lengths: [0.75, 0.25], syllables: ['tim', 'ri'] },
  triplet: { id: 'triplet', lengths: [1 / 3, 1 / 3, 1 / 3], syllables: ['tri', 'o', 'la'], triplet: true }
}

export interface SolfegeLevel {
  name: string
  hint: string
  /** Key signatures (fifths) and modes allowed. */
  keys: [number, 'major' | 'minor'][]
  meters: number[]
  cells: string[]
  /** Largest leap in diatonic steps (2 = a third). */
  maxLeap: number
  /** Share of steps among the moves. */
  stepShare: number
  /** Range around the tonic in diatonic steps (low, high). */
  range: [number, number]
  measures: number
  chromatic: boolean
}

export const SOLFEGE_LEVELS: SolfegeLevel[] = [
  {
    name: 'Primi passi',
    hint: 'Do maggiore, semiminime e minime, gradi congiunti, ambito di quinta',
    keys: [[0, 'major']],
    meters: [4],
    cells: ['ta', 'half'],
    maxLeap: 1,
    stepShare: 1,
    range: [0, 4],
    measures: 4,
    chromatic: false
  },
  {
    name: 'Crome e terze',
    hint: 'Do e Sol maggiore, crome, salti di terza, ambito di sesta',
    keys: [
      [0, 'major'],
      [1, 'major']
    ],
    meters: [4, 2],
    cells: ['ta', 'titi', 'half'],
    maxLeap: 2,
    stepShare: 0.75,
    range: [-1, 5],
    measures: 4,
    chromatic: false
  },
  {
    name: 'Puntato e pause',
    hint: 'Fino a una alterazione, 3/4, semiminima puntata, pause, salti fino alla quarta',
    keys: [
      [0, 'major'],
      [1, 'major'],
      [-1, 'major'],
      [0, 'minor']
    ],
    meters: [4, 3],
    cells: ['ta', 'titi', 'half', 'dottedQuarter', 'rest', 'restTi', 'dottedHalf'],
    maxLeap: 3,
    stepShare: 0.7,
    range: [-2, 7],
    measures: 4,
    chromatic: false
  },
  {
    name: 'Semicrome',
    hint: 'Fino a due alterazioni, le cellule con le semicrome, salti di quinta (arpeggi)',
    keys: [
      [0, 'major'],
      [1, 'major'],
      [2, 'major'],
      [-1, 'major'],
      [-2, 'major'],
      [0, 'minor'],
      [-1, 'minor']
    ],
    meters: [4, 3, 2],
    cells: ['ta', 'titi', 'half', 'dottedQuarter', 'rest', 'tiriTiri', 'tiTiri', 'tiriTi'],
    maxLeap: 4,
    stepShare: 0.65,
    range: [-3, 8],
    measures: 8,
    chromatic: false
  },
  {
    name: 'Sincopi e puntati brevi',
    hint: 'Fino a tre alterazioni, sincopi, croma puntata e semicroma, note di passaggio cromatiche',
    keys: [
      [0, 'major'],
      [2, 'major'],
      [3, 'major'],
      [-2, 'major'],
      [-3, 'major'],
      [1, 'minor'],
      [-1, 'minor'],
      [-2, 'minor']
    ],
    meters: [4, 3, 2],
    cells: ['ta', 'titi', 'dottedQuarter', 'tiriTiri', 'tiTiri', 'tiriTi', 'syncopation', 'dottedEighth', 'restTi'],
    maxLeap: 5,
    stepShare: 0.6,
    range: [-3, 9],
    measures: 8,
    chromatic: true
  },
  {
    name: 'Terzine e salti ampi',
    hint: 'Tutte le cellule, terzine, salti fino all’ottava, minore armonica',
    keys: [
      [0, 'major'],
      [3, 'major'],
      [4, 'major'],
      [-3, 'major'],
      [-4, 'major'],
      [0, 'minor'],
      [2, 'minor'],
      [-3, 'minor']
    ],
    meters: [4, 3, 2],
    cells: [
      'ta',
      'titi',
      'dottedQuarter',
      'tiriTiri',
      'tiTiri',
      'tiriTi',
      'syncopation',
      'dottedEighth',
      'triplet',
      'restTi'
    ],
    maxLeap: 7,
    stepShare: 0.55,
    range: [-4, 9],
    measures: 8,
    chromatic: true
  }
]

// --- Keys and spelling --------------------------------------------------------------

const LETTERS = 'CDEFGAB'
const STEP_PC = [0, 2, 4, 5, 7, 9, 11]
const SHARP_ORDER = 'FCGDAEB'
const FLAT_ORDER = 'BEADGCF'
const ITALIAN = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si']
const MAJOR_TONIC: Record<number, string> = {
  0: 'C',
  1: 'G',
  2: 'D',
  3: 'A',
  4: 'E',
  [-1]: 'F',
  [-2]: 'B',
  [-3]: 'E',
  [-4]: 'A'
}
const MINOR_TONIC: Record<number, string> = {
  0: 'A',
  1: 'E',
  2: 'B',
  3: 'F',
  [-1]: 'D',
  [-2]: 'G',
  [-3]: 'C',
  [-4]: 'F'
}

export interface PhraseKey {
  fifths: number
  mode: 'major' | 'minor'
  /** Diatonic index (C0 = 0) of the tonic in the octave the phrase is around. */
  tonic: number
  name: string
}

/** Alteration the key signature gives to a letter (0-6). */
export function signatureAlter(fifths: number, step: number): number {
  const letter = LETTERS[step]
  if (fifths > 0) return SHARP_ORDER.slice(0, fifths).includes(letter) ? 1 : 0
  if (fifths < 0) return FLAT_ORDER.slice(0, -fifths).includes(letter) ? -1 : 0
  return 0
}

export function makeKey(fifths: number, mode: 'major' | 'minor'): PhraseKey {
  const letter = (mode === 'major' ? MAJOR_TONIC : MINOR_TONIC)[fifths]
  const step = LETTERS.indexOf(letter)
  // Tonic around the top of the treble staff's lower half: C4..B4.
  const tonic = 4 * 7 + step
  const alter = signatureAlter(fifths, step)
  const sign = alter > 0 ? '♯' : alter < 0 ? '♭' : ''
  return { fifths, mode, tonic, name: `${ITALIAN[step]}${sign} ${mode === 'major' ? 'maggiore' : 'minore'}` }
}

/** A written note: diatonic index (C0 = 0) and alteration. */
export interface PhraseNote {
  start: number
  length: number
  rest: boolean
  triplet: boolean
  /** Diatonic index; meaningless for a rest. */
  degree: number
  alter: number
  syllable: string
}

export function midiOf(diatonic: number, alter: number): number {
  const octave = Math.floor(diatonic / 7)
  return 12 * (octave + 1) + STEP_PC[((diatonic % 7) + 7) % 7] + alter
}

export function noteName(n: { degree: number; alter: number }): string {
  const sign = { [-1]: '♭', 0: '', 1: '♯' }[n.alter] ?? ''
  return `${ITALIAN[((n.degree % 7) + 7) % 7]}${sign}`
}

// --- Rhythm -------------------------------------------------------------------------

function pick<T>(xs: readonly T[], rnd: Random): T {
  return xs[Math.floor(rnd() * xs.length) % xs.length]
}

const span = (c: Cell) => c.lengths.reduce((s, x) => s + Math.abs(x), 0)

/** One measure of cells filling `beats` quarters; the last measure ends on a long note. */
function measureCells(level: SolfegeLevel, beats: number, last: boolean, first: boolean, rnd: Random): Cell[] {
  if (last) {
    const end = beats === 4 ? [CELLS.half, CELLS.half] : beats === 3 ? [CELLS.dottedHalf] : [CELLS.half]
    // Something to move to the final note when the measure has room.
    if (beats === 4)
      return [
        pick(
          [CELLS.ta, CELLS.titi].filter((c) => level.cells.includes(c.id)),
          rnd
        ),
        CELLS.ta,
        CELLS.half
      ]
    if (beats === 3 && level.cells.includes('dottedHalf')) return end
    if (beats === 1) return [CELLS.ta] // shortened by a pickup
    return beats === 3 ? [CELLS.ta, CELLS.half] : end
  }
  for (let tries = 0; tries < 40; tries++) {
    const out: Cell[] = []
    let left = beats
    while (left > 0) {
      const fits = level.cells.map((id) => CELLS[id]).filter((c) => span(c) <= left + 1e-9)
      // A rest never opens the phrase; long cells only on strong beats.
      const usable = fits.filter((c) => !(first && out.length === 0 && c.lengths[0] < 0))
      const c = pick(usable.length ? usable : [CELLS.ta], rnd)
      out.push(c)
      left -= span(c)
    }
    if (Math.abs(left) < 1e-9) return out
  }
  return Array.from({ length: beats }, () => CELLS.ta)
}

// --- Melody -------------------------------------------------------------------------

/** Lowest and highest degree: the level's range, kept between A3 and A5 (treble staff and a few ledger lines). */
export function bounds(level: SolfegeLevel, key: PhraseKey): [number, number] {
  return [Math.max(key.tonic + level.range[0], 3 * 7 + 5), Math.min(key.tonic + level.range[1], 5 * 7 + 5)]
}

/** Next degree (diatonic index) after `prev`, keeping to the rules of the level. */
function nextDegree(prev: number, lastMove: number, level: SolfegeLevel, key: PhraseKey, rnd: Random): number {
  const [lo, hi] = bounds(level, key)
  for (let tries = 0; tries < 30; tries++) {
    let move: number
    if (Math.abs(lastMove) >= 3) {
      move = -Math.sign(lastMove) // after a leap, a step the other way
    } else if (rnd() < level.stepShare) {
      move = rnd() < 0.5 ? 1 : -1
      if (rnd() < 0.12) move = 0 // a repeated note now and then
    } else {
      const size = 2 + Math.floor(rnd() * (level.maxLeap - 1))
      move = (rnd() < 0.5 ? 1 : -1) * size
    }
    const d = prev + move
    if (d >= lo && d <= hi && Math.abs(move) <= level.maxLeap) return d
  }
  return prev + (prev > key.tonic ? -1 : 1)
}

export interface Phrase {
  key: PhraseKey
  meter: number
  notes: PhraseNote[]
  level: number
  /** Quarters before the first bar line (0: the phrase starts on the downbeat). */
  pickup: number
}

/** Whether phrases start in levare: never, now and then, or always. */
export type PickupMode = 'never' | 'sometimes' | 'always'

/** A phrase of `level` (0-5): rhythm from the level's cells, melody by the rules. */
export function nextPhrase(levelIndex: number, rnd: Random = Math.random, pickupMode: PickupMode = 'never'): Phrase {
  const level = SOLFEGE_LEVELS[Math.max(0, Math.min(SOLFEGE_LEVELS.length - 1, levelIndex))]
  const [fifths, mode] = pick(level.keys, rnd)
  const key = makeKey(fifths, mode)
  const meter = pick(level.meters, rnd)
  const notes: PhraseNote[] = []
  // A pickup of one beat (two in 3/4 and 4/4 from level 4): the last measure is
  // shortened by as much, so the phrase still has whole measures.
  const wantsPickup = pickupMode === 'always' || (pickupMode === 'sometimes' && rnd() < 0.5)
  const pickup = !wantsPickup ? 0 : levelIndex >= 3 && meter >= 3 && rnd() < 0.4 ? 2 : 1
  let t = 0
  const push = (cell: Cell) =>
    cell.lengths.forEach((length, i) => {
      notes.push({
        start: t,
        length: Math.abs(length),
        rest: length < 0,
        triplet: !!cell.triplet,
        degree: 0,
        alter: 0,
        syllable: cell.syllables[i]
      })
      t += Math.abs(length)
    })
  if (pickup) {
    const oneBeat = level.cells.map((id) => CELLS[id]).filter((c) => Math.abs(span(c) - 1) < 1e-9 && c.lengths[0] > 0)
    for (let b = 0; b < pickup; b++) push(pick(oneBeat.length ? oneBeat : [CELLS.ta], rnd))
  }
  for (let m = 0; m < level.measures; m++) {
    const last = m === level.measures - 1
    for (const cell of measureCells(level, last ? meter - pickup : meter, last, m === 0, rnd)) {
      push(cell)
    }
  }
  // Pitches: start on 1, 3 or 5; end on the tonic from the 2nd or the 7th.
  // In levare: the pickup leads to the tonic on the first downbeat, from the
  // 5th below (Sol-Do) or from the leading tone, by step when it has more notes.
  const sounding = notes.filter((n) => !n.rest)
  const inPickup = sounding.filter((n) => n.start < pickup - 1e-9).length
  const [lo] = bounds(level, key)
  const into = key.tonic - 3 >= lo && rnd() < 0.6 ? key.tonic - 3 : key.tonic - 1
  let degree = inPickup ? into : key.tonic + pick(level.range[1] >= 4 ? [0, 2, 4] : [0, 2], rnd)
  let lastMove = 0
  sounding.forEach((n, i) => {
    const left = sounding.length - 1 - i
    if (i < inPickup) {
      // Up to it by step, or down to it when there is no room below.
      const steps = inPickup - 1 - i
      degree = into - (inPickup - 1) >= lo ? into - steps : into + steps
      lastMove = i > 0 ? 1 : 0
    } else if (i === inPickup && inPickup > 0) {
      lastMove = key.tonic - degree
      degree = key.tonic
    } else if (i > 0) {
      const next = nextDegree(degree, lastMove, level, key, rnd)
      lastMove = next - degree
      degree = next
    }
    if (left === 1) degree = pick([key.tonic + 1, key.tonic - 1], rnd) // 2nd or leading tone
    if (left === 0) degree = key.tonic
    n.degree = degree
    n.alter = signatureAlter(key.fifths, ((degree % 7) + 7) % 7)
  })
  // Minor: the leading tone is raised (harmonic minor).
  if (mode === 'minor') {
    for (const n of sounding) if ((((n.degree - key.tonic) % 7) + 7) % 7 === 6) n.alter += 1
  }
  // Chromatic passing notes: a step up between two steps up, raised.
  if (level.chromatic) {
    for (let i = 1; i < sounding.length - 1; i++) {
      const [a, b, c] = [sounding[i - 1], sounding[i], sounding[i + 1]]
      if (
        b.degree - a.degree === 1 &&
        c.degree - b.degree === 1 &&
        b.alter === signatureAlter(key.fifths, ((b.degree % 7) + 7) % 7) &&
        b.alter < 1 &&
        rnd() < 0.3
      ) {
        // Raised so that it leads to the next note by a semitone.
        if (midiOf(c.degree, c.alter) - midiOf(b.degree, b.alter + 1) === 1) b.alter += 1
      }
    }
  }
  return { key, meter, notes, level: levelIndex, pickup }
}

// --- MusicXML and events ---------------------------------------------------------------

const DIV = 12
const TYPES: Record<string, [string, number]> = {
  '3': ['half', 1],
  '2': ['half', 0],
  '1.5': ['quarter', 1],
  '1': ['quarter', 0],
  '0.75': ['eighth', 1],
  '0.5': ['eighth', 0],
  '0.25': ['16th', 0]
}
const ACCIDENTAL: Record<number, string> = { [-1]: 'flat', 0: 'natural', 1: 'sharp' }

export type LyricMode = 'none' | 'syllables' | 'names'

/** The phrase as MusicXML on a treble staff, with key, meter and an optional lyric line. */
export function phraseXml(p: Phrase, lyrics: LyricMode = 'none'): string {
  const measures: string[] = []
  const total = p.notes.reduce((x, n) => x + n.length, 0)
  const bars = barsOf(total, p.meter, p.pickup)
  const count = bars.length
  for (let m = 0; m < count; m++) {
    const [from, to] = bars[m]
    const inMeasure = p.notes.filter((n) => n.start >= from - 1e-9 && n.start < to - 1e-9)
    const offset = m === 0 && p.pickup > 0 ? p.meter - p.pickup : 0
    const beams = beamsFor(
      inMeasure.map(
        (n) => ({ start: n.start - from + offset, length: n.length, rest: n.rest, triplet: n.triplet }) as RhythmNote
      )
    )
    const shown = new Map<number, number>() // diatonic -> alteration in force in this measure
    let tripletCount = 0
    const body = inMeasure
      .map((n, i) => {
        const [type, dots] = n.triplet ? ['eighth', 0] : (TYPES[String(n.length)] ?? ['quarter', 0])
        let pitch = '<rest/>'
        let accidental = ''
        if (!n.rest) {
          const step = ((n.degree % 7) + 7) % 7
          const octave = Math.floor(n.degree / 7)
          const inForce = shown.get(n.degree) ?? signatureAlter(p.key.fifths, step)
          if (inForce !== n.alter) accidental = `<accidental>${ACCIDENTAL[n.alter]}</accidental>`
          shown.set(n.degree, n.alter)
          pitch = `<pitch><step>${LETTERS[step]}</step>${n.alter ? `<alter>${n.alter}</alter>` : ''}<octave>${octave}</octave></pitch>`
        }
        let tm = ''
        let tuplet = ''
        if (n.triplet) {
          tm = '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>'
          const k = tripletCount++ % 3
          if (k === 0) tuplet = '<tuplet type="start" bracket="no"/>'
          if (k === 2) tuplet = '<tuplet type="stop"/>'
        }
        const text = lyrics === 'syllables' ? n.syllable : lyrics === 'names' && !n.rest ? noteName(n) : ''
        const lyric = text ? `<lyric number="1"><syllabic>single</syllabic><text>${text}</text></lyric>` : ''
        return (
          `<note>${pitch}<duration>${Math.round(n.length * DIV)}</duration><voice>1</voice><type>${type}</type>` +
          `${'<dot/>'.repeat(dots)}${accidental}${tm}<stem>${n.degree >= 4 * 7 + 6 ? 'down' : 'up'}</stem>${beams[i]}` +
          `${tuplet ? `<notations>${tuplet}</notations>` : ''}${lyric}</note>`
        )
      })
      .join('')
    const attrs =
      m === 0
        ? `<attributes><divisions>${DIV}</divisions><key><fifths>${p.key.fifths}</fifths><mode>${p.key.mode}</mode></key><time><beats>${p.meter}</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>`
        : ''
    const bar = m === count - 1 ? '<barline location="right"><bar-style>light-heavy</bar-style></barline>' : ''
    const number = p.pickup > 0 ? m : m + 1
    measures.push(
      `<measure number="${number}"${p.pickup > 0 && m === 0 ? ' implicit="yes"' : ''}>${attrs}${body}${bar}</measure>`
    )
  }
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name></part-name></score-part></part-list><part id="P1">${measures.join('')}</part></score-partwise>`
}

/** Notes for the Rust transport (to hear it, or to judge it), at `bpm`. */
export function phraseEvents(p: Phrase, bpm: number) {
  const q = 60000 / bpm
  const lead = pickupLead(p.pickup, p.meter)
  return p.notes
    .filter((n) => !n.rest)
    .map((n, i) => ({
      noteId: `solfege-${i}`,
      pitch: midiOf(n.degree, n.alter),
      onsetMs: (n.start + lead) * q,
      durMs: n.length * q * 0.92,
      velocity: 80,
      staff: 1,
      measure: n.start < p.pickup ? 0 : Math.floor((n.start - p.pickup) / p.meter + 1e-9) + 1
    }))
}

/** One click per beat, accent on each downbeat. */
export function phraseClicks(p: Phrase, bpm: number) {
  const q = 60000 / bpm
  const total = Math.round(p.notes.reduce((s, n) => s + n.length, 0) + pickupLead(p.pickup, p.meter))
  return Array.from({ length: total }, (_, i) => ({ ms: i * q, accent: i % p.meter === 0 }))
}
