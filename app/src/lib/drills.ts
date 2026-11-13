/**
 * Short sight-reading drills (pure logic, tested): what to show, what counts as
 * the right answer, and the statistics of a session.
 * - notes: one note on a staff, play it;
 * - shapes: an interval or a triad, play all its notes together;
 * - rhythm: a two-measure rhythm, tap it on any key with the metronome.
 */

export type Clef = 'treble' | 'bass' | 'both'
export type Zone = 'staff' | 'ledger' | 'all'

/** A written note: diatonic step 0-6 (C..B), alteration, octave. */
export interface WrittenNote {
  step: number
  alter: number
  octave: number
}

const STEP_PC = [0, 2, 4, 5, 7, 9, 11]
const STEPS = 'CDEFGAB'
const ITALIAN = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si']

export function midiOf(n: WrittenNote): number {
  return 12 * (n.octave + 1) + STEP_PC[n.step] + n.alter
}

/** Diatonic index (C4 = 28): steps from C0. */
function diatonic(n: { step: number; octave: number }): number {
  return n.octave * 7 + n.step
}

function fromDiatonic(d: number, alter = 0): WrittenNote {
  return { step: ((d % 7) + 7) % 7, octave: Math.floor(d / 7), alter }
}

export function noteLabel(n: WrittenNote): string {
  const sign = { [-1]: '♭', 0: '', 1: '♯' }[n.alter] ?? ''
  return `${ITALIAN[n.step]}${sign}${n.octave}`
}

export function pitchXml(n: WrittenNote): string {
  return `<step>${STEPS[n.step]}</step>${n.alter ? `<alter>${n.alter}</alter>` : ''}<octave>${n.octave}</octave>`
}

/** Diatonic ranges (inclusive) of each clef: on the staff, and with ledger lines. */
const RANGES = {
  treble: {
    staff: [diatonic({ step: 2, octave: 4 }), diatonic({ step: 3, octave: 5 })],
    low: diatonic({ step: 5, octave: 3 }),
    high: diatonic({ step: 0, octave: 6 })
  },
  bass: {
    staff: [diatonic({ step: 4, octave: 2 }), diatonic({ step: 5, octave: 3 })],
    low: diatonic({ step: 0, octave: 2 }),
    high: diatonic({ step: 2, octave: 4 })
  }
} as const

/** Positions a note of this clef and zone may take (diatonic indices). */
export function positions(clef: 'treble' | 'bass', zone: Zone): number[] {
  const r = RANGES[clef]
  const [lo, hi] = r.staff
  const out: number[] = []
  for (let d = r.low; d <= r.high; d++) {
    const onStaff = d >= lo && d <= hi
    if (zone === 'all' || (zone === 'staff' && onStaff) || (zone === 'ledger' && !onStaff)) out.push(d)
  }
  return out
}

export type Random = () => number

function pick<T>(xs: readonly T[], rnd: Random): T {
  return xs[Math.floor(rnd() * xs.length) % xs.length]
}

export interface NoteQuestion {
  clef: 'treble' | 'bass'
  notes: WrittenNote[]
  /** Played one after the other, in this order (an arpeggio), not together. */
  sequence?: boolean
  /** What the player sees after answering. */
  label: string
}

export interface NoteDrillOptions {
  clef: Clef
  zone: Zone
  accidentals: boolean
}

/** A note to read, never the same as the previous one. */
export function nextNote(o: NoteDrillOptions, previous: NoteQuestion | null, rnd: Random = Math.random): NoteQuestion {
  for (let tries = 0; tries < 20; tries++) {
    const clef = o.clef === 'both' ? (rnd() < 0.5 ? 'treble' : 'bass') : o.clef
    const d = pick(positions(clef, o.zone), rnd)
    let alter = 0
    if (o.accidentals && rnd() < 0.35) alter = rnd() < 0.5 ? -1 : 1
    const n = fromDiatonic(d, alter)
    // B# / Cb / E# / Fb are rare in reading practice.
    if ((alter === 1 && (n.step === 2 || n.step === 6)) || (alter === -1 && (n.step === 0 || n.step === 3))) continue
    if (previous && midiOf(previous.notes[0]) === midiOf(n)) continue
    return { clef, notes: [n], label: noteLabel(n) }
  }
  return { clef: 'treble', notes: [{ step: 0, alter: 0, octave: 5 }], label: 'Do5' }
}

// --- Intervals and triads --------------------------------------------------------

export type ShapeKind = 'intervals' | 'triads' | 'both' | 'arpeggios' | 'all'

const INTERVAL_NAMES = ['', '', '2ª', '3ª', '4ª', '5ª', '6ª', '7ª', '8ª']
/** Semitones of the major/perfect interval of each number. */
const PERFECT = [0, 0, 2, 4, 5, 7, 9, 11, 12]

function qualityName(number: number, semitones: number): string {
  const diff = semitones - PERFECT[number]
  if ([4, 5, 8].includes(number)) return { [-1]: 'diminuita', 0: 'giusta', 1: 'eccedente' }[diff] ?? ''
  return { [-2]: 'diminuita', [-1]: 'minore', 0: 'maggiore', 1: 'eccedente' }[diff] ?? ''
}

/** A note `number` steps above `base`, with the alteration that gives `semitones`. */
function above(base: WrittenNote, number: number, semitones: number): WrittenNote | null {
  const n = fromDiatonic(diatonic(base) + number - 1)
  n.alter = midiOf(base) + semitones - midiOf({ ...n, alter: 0 })
  return Math.abs(n.alter) <= 1 ? n : null
}

export interface ShapeOptions {
  clef: 'treble' | 'bass'
  kind: ShapeKind
  accidentals: boolean
}

const TRIADS: { name: string; thirds: [number, number] }[] = [
  { name: 'maggiore', thirds: [4, 3] },
  { name: 'minore', thirds: [3, 4] }
]
const INVERSIONS = ['stato fondamentale', '1° rivolto', '2° rivolto']

const ARPEGGIO_PATTERNS = ['ascendente', 'discendente', 'su e giù', 'basso albertino'] as const

const rootName = (n: WrittenNote) => `${ITALIAN[n.step]}${{ [-1]: '♭', 0: '', 1: '♯' }[n.alter] ?? ''}`

/**
 * A broken chord, to play note by note in the written order: a major or minor
 * triad in any position (or, with accidentals, a dominant seventh), going up,
 * down, up and down, or as an Alberti bass (1-5-3-5).
 */
export function nextArpeggio(o: ShapeOptions, previous: NoteQuestion | null, rnd: Random = Math.random): NoteQuestion {
  const [lo, hi] = RANGES[o.clef].staff
  for (let tries = 0; tries < 60; tries++) {
    const root = fromDiatonic(lo + Math.floor(rnd() * (hi - lo - 3)))
    if (o.accidentals && rnd() < 0.3) root.alter = rnd() < 0.5 ? -1 : 1
    const seventh = o.accidentals && rnd() < 0.3
    const quality = seventh ? TRIADS[0] : pick(TRIADS, rnd)
    const third = above(root, 3, quality.thirds[0])
    const fifth = above(root, 5, 7)
    const sev = seventh ? above(root, 7, 10) : null
    if (!third || !fifth || (seventh && !sev)) continue
    const up = (n: WrittenNote) => ({ ...n, octave: n.octave + 1 })
    let pattern: (typeof ARPEGGIO_PATTERNS)[number] = pick(ARPEGGIO_PATTERNS, rnd)
    if (seventh && pattern === 'basso albertino') pattern = 'ascendente'
    const inversion = seventh || pattern === 'basso albertino' ? 0 : Math.floor(rnd() * 3)
    const block = seventh
      ? [root, third, fifth, sev as WrittenNote]
      : inversion === 0
        ? [root, third, fifth]
        : inversion === 1
          ? [third, fifth, up(root)]
          : [fifth, up(root), up(third)]
    let notes: WrittenNote[]
    if (pattern === 'basso albertino') notes = [root, fifth, third, fifth]
    else if (seventh)
      notes =
        pattern === 'discendente'
          ? [...block].reverse()
          : pattern === 'su e giù'
            ? [...block, block[2], block[1]]
            : block
    else {
      const withOctave = [...block, up(block[0])]
      notes =
        pattern === 'ascendente'
          ? withOctave
          : pattern === 'discendente'
            ? [...withOctave].reverse()
            : [...block, block[1]]
    }
    if (!o.accidentals && notes.some((n) => n.alter !== 0)) continue
    if (Math.max(...notes.map(diatonic)) > RANGES[o.clef].high) continue
    const chord = seventh ? `${rootName(root)}7 (settima di dominante)` : `${rootName(root)} ${quality.name}`
    const position = seventh || pattern === 'basso albertino' ? '' : `, ${INVERSIONS[inversion]}`
    const label = `${chord}, ${pattern === 'basso albertino' ? 'basso albertino' : `arpeggio ${pattern}`}${position}`
    if (previous && previous.label === label && midiOf(previous.notes[0]) === midiOf(notes[0])) continue
    return { clef: o.clef, notes, label, sequence: true }
  }
  return {
    clef: o.clef,
    notes: [fromDiatonic(lo + 2), fromDiatonic(lo + 4), fromDiatonic(lo + 6)],
    label: 'arpeggio',
    sequence: true
  }
}

/** An interval (two notes together), a major/minor triad in any position, or an arpeggio. */
export function nextShape(o: ShapeOptions, previous: NoteQuestion | null, rnd: Random = Math.random): NoteQuestion {
  if (o.kind === 'arpeggios' || (o.kind === 'all' && rnd() < 1 / 3)) return nextArpeggio(o, previous, rnd)
  const [lo, hi] = RANGES[o.clef].staff
  for (let tries = 0; tries < 50; tries++) {
    const triad = o.kind === 'triads' || ((o.kind === 'both' || o.kind === 'all') && rnd() < 0.5)
    const base = fromDiatonic(lo + Math.floor(rnd() * (hi - lo - 4)))
    if (o.accidentals && rnd() < 0.3) base.alter = rnd() < 0.5 ? -1 : 1
    let notes: (WrittenNote | null)[]
    let label: string
    if (!triad) {
      const number = 2 + Math.floor(rnd() * 7)
      let semitones = PERFECT[number]
      if (o.accidentals || rnd() < 0.5) semitones += [4, 5, 8].includes(number) ? 0 : -1 * Math.floor(rnd() * 2)
      if (!o.accidentals) {
        // White keys only: the interval is whatever the two white keys make.
        const top = fromDiatonic(diatonic(base) + number - 1)
        if (base.alter) continue
        semitones = midiOf(top) - midiOf(base)
      }
      notes = [base, above(base, number, semitones)]
      label = `${INTERVAL_NAMES[number]} ${qualityName(number, semitones)}`
    } else {
      const quality = pick(TRIADS, rnd)
      const inversion = Math.floor(rnd() * 3)
      const root = base
      const third = above(root, 3, quality.thirds[0])
      const fifth = above(root, 5, 7)
      if (!third || !fifth) continue
      const up = (n: WrittenNote) => ({ ...n, octave: n.octave + 1 })
      notes =
        inversion === 0
          ? [root, third, fifth]
          : inversion === 1
            ? [third, fifth, up(root)]
            : [fifth, up(root), up(third)]
      if (!o.accidentals && notes.some((n) => n !== null && n.alter !== 0)) continue
      label = `${ITALIAN[root.step]}${{ [-1]: '♭', 0: '', 1: '♯' }[root.alter] ?? ''} ${quality.name}, ${INVERSIONS[inversion]}`
    }
    if (notes.some((n) => n === null)) continue
    const written = notes as WrittenNote[]
    const top = Math.max(...written.map(diatonic))
    if (top > RANGES[o.clef].high) continue
    if (previous && previous.label === label && midiOf(previous.notes[0]) === midiOf(written[0])) continue
    return { clef: o.clef, notes: written, label }
  }
  return { clef: o.clef, notes: [fromDiatonic(lo + 2), fromDiatonic(lo + 4)], label: '3ª' }
}

/**
 * Whether the keys held answer the question: every note, nothing else
 * (`anyOctave`: pitch classes only). "wrong" as soon as a key not in it is down.
 */
export function answer(held: readonly number[], q: NoteQuestion, anyOctave = false): 'right' | 'wrong' | 'partial' {
  const key = (p: number) => (anyOctave ? ((p % 12) + 12) % 12 : p)
  const want = new Set(q.notes.map((n) => key(midiOf(n))))
  const got = new Set(held.map(key))
  if ([...got].some((p) => !want.has(p))) return 'wrong'
  return [...want].every((p) => got.has(p)) ? 'right' : 'partial'
}

/**
 * An arpeggio is played note by note: the key played against the note expected
 * at `index`. "next" moves on, "done" was the last one, "wrong" stays there.
 */
export function sequenceStep(pitch: number, q: NoteQuestion, index: number): 'next' | 'done' | 'wrong' {
  const expected = q.notes[index]
  if (!expected || midiOf(expected) !== pitch) return 'wrong'
  return index === q.notes.length - 1 ? 'done' : 'next'
}

// --- Session statistics ------------------------------------------------------------

export interface Attempt {
  label: string
  ms: number
  /** Played right at the first try. */
  clean: boolean
}

export interface SessionStats {
  done: number
  perMinute: number
  meanMs: number
  firstTry: number
  slowest: Attempt[]
}

export function sessionStats(attempts: readonly Attempt[], elapsedMs: number): SessionStats {
  const done = attempts.length
  const meanMs = done ? attempts.reduce((s, a) => s + a.ms, 0) / done : 0
  return {
    done,
    perMinute: elapsedMs > 0 ? (done * 60000) / elapsedMs : 0,
    meanMs,
    firstTry: done ? attempts.filter((a) => a.clean).length / done : 0,
    slowest: [...attempts].sort((a, b) => b.ms - a.ms).slice(0, 5)
  }
}

// --- Rhythm ---------------------------------------------------------------------------

/** A rhythm event in quarters; `rest` is not tapped. */
export interface RhythmNote {
  start: number
  length: number
  rest: boolean
  /** Part of a triplet group. */
  triplet: boolean
}

export const RHYTHM_LEVELS = [
  'Semiminime e minime',
  'Con le crome',
  'Con puntate e pause',
  'Con le semicrome',
  'Con le terzine'
] as const

/** Ways to fill one beat (quarters), by the level that introduces them. */
const BEAT_CELLS: { level: number; cell: [number, boolean][]; triplet?: boolean }[] = [
  { level: 0, cell: [[1, false]] },
  {
    level: 1,
    cell: [
      [0.5, false],
      [0.5, false]
    ]
  },
  { level: 2, cell: [[1, true]] },
  {
    level: 2,
    cell: [
      [0.5, true],
      [0.5, false]
    ]
  },
  {
    level: 3,
    cell: [
      [0.25, false],
      [0.25, false],
      [0.25, false],
      [0.25, false]
    ]
  },
  {
    level: 3,
    cell: [
      [0.5, false],
      [0.25, false],
      [0.25, false]
    ]
  },
  {
    level: 3,
    cell: [
      [0.25, false],
      [0.25, false],
      [0.5, false]
    ]
  },
  {
    level: 3,
    cell: [
      [0.75, false],
      [0.25, false]
    ]
  },
  {
    level: 4,
    cell: [
      [1 / 3, false],
      [1 / 3, false],
      [1 / 3, false]
    ],
    triplet: true
  }
]

/** Two measures of 4/4 at `level` (0-4): never starting with a rest, never empty. */
export function nextRhythm(level: number, rnd: Random = Math.random): RhythmNote[] {
  const out: RhythmNote[] = []
  let t = 0
  while (t < 8) {
    // Half notes (and dotted quarter + eighth) span two beats, within a measure.
    const inMeasure = t % 4
    if (inMeasure <= 2 && rnd() < 0.18) {
      if (level >= 2 && rnd() < 0.5) {
        out.push(
          { start: t, length: 1.5, rest: false, triplet: false },
          { start: t + 1.5, length: 0.5, rest: false, triplet: false }
        )
      } else {
        out.push({ start: t, length: 2, rest: false, triplet: false })
      }
      t += 2
      continue
    }
    const cells = BEAT_CELLS.filter((c) => c.level <= level)
    const c = pick(cells, rnd)
    let at = t
    for (const [length, rest] of c.cell) {
      out.push({ start: at, length, rest: rest && t > 0, triplet: !!c.triplet })
      at += length
    }
    t += 1
  }
  return out
}

/** The rhythm as MusicXML on one line (percussion clef), for Verovio. */
export function rhythmXml(rhythm: readonly RhythmNote[]): string {
  const div = 12
  const types: Record<string, [string, number]> = {
    '4': ['whole', 0],
    '3': ['half', 1],
    '2': ['half', 0],
    '1.5': ['quarter', 1],
    '1': ['quarter', 0],
    '0.75': ['eighth', 1],
    '0.5': ['eighth', 0],
    '0.25': ['16th', 0]
  }
  const measures: string[] = []
  for (let m = 0; m < 2; m++) {
    const notes = rhythm.filter((n) => n.start >= m * 4 - 1e-9 && n.start < m * 4 + 4 - 1e-9)
    const beams = beamsFor(notes)
    const body = notes
      .map((n, i) => {
        const dur = Math.round(n.length * div)
        let type: string
        let dots = 0
        let tm = ''
        let tuplet = ''
        if (n.triplet) {
          type = 'eighth'
          tm = '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>'
          const k = notes.slice(0, i).filter((x) => x.triplet).length % 3
          if (k === 0) tuplet = '<notations><tuplet type="start" bracket="no"/></notations>'
          if (k === 2) tuplet = '<notations><tuplet type="stop"/></notations>'
        } else {
          ;[type, dots] = types[String(n.length)] ?? ['quarter', 0]
        }
        const pitch = n.rest
          ? '<rest/>'
          : '<unpitched><display-step>E</display-step><display-octave>4</display-octave></unpitched>'
        return `<note>${pitch}<duration>${dur}</duration><voice>1</voice><type>${type}</type>${'<dot/>'.repeat(dots)}${tm}<stem>up</stem>${beams[i]}${tuplet}</note>`
      })
      .join('')
    const attrs =
      m === 0
        ? `<attributes><divisions>${div}</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>percussion</sign></clef><staff-details><staff-lines>1</staff-lines></staff-details></attributes>`
        : ''
    measures.push(`<measure number="${m + 1}">${attrs}${body}</measure>`)
  }
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name></part-name></score-part></part-list><part id="P1">${measures.join('')}</part></score-partwise>`
}

/**
 * <beam> elements: notes shorter than a quarter are beamed within their beat;
 * sixteenths get a second beam (a hook when alone). Rests break the beam.
 */
export function beamsFor(notes: readonly RhythmNote[]): string[] {
  const out = notes.map(() => '')
  const short = (n: RhythmNote) => !n.rest && n.length < 1 - 1e-9 && n.length !== 0.75
  const byBeat = new Map<number, number[]>()
  notes.forEach((n, i) => {
    const beat = Math.floor(n.start + 1e-9)
    byBeat.set(beat, [...(byBeat.get(beat) ?? []), i])
  })
  for (const idx of byBeat.values()) {
    const group = idx.filter((i) => short(notes[i]) || (notes[i].length === 0.75 && !notes[i].rest))
    if (group.length < 2 || group.some((i) => notes[i].rest)) continue
    group.forEach((i, k) => {
      const first = beamValue(k, group.length)
      const sixteenth = notes[i].length === 0.25
      let second = ''
      if (sixteenth) {
        const prev = k > 0 && notes[group[k - 1]].length === 0.25
        const next = k < group.length - 1 && notes[group[k + 1]].length === 0.25
        const v = prev && next ? 'continue' : prev ? 'end' : next ? 'begin' : k === 0 ? 'forward hook' : 'backward hook'
        second = `<beam number="2">${v}</beam>`
      }
      out[i] = `<beam number="1">${first}</beam>${second}`
    })
  }
  return out
}

function beamValue(k: number, n: number): string {
  return k === 0 ? 'begin' : k === n - 1 ? 'end' : 'continue'
}

/** A note or chord on its clef as MusicXML (a whole note, no time signature). */
export function questionXml(q: NoteQuestion): string {
  const clef = q.clef === 'treble' ? '<sign>G</sign><line>2</line>' : '<sign>F</sign><line>4</line>'
  if (q.sequence) return sequenceXml(q, clef)
  const notes = q.notes
    .map(
      (n, i) =>
        `<note>${i ? '<chord/>' : ''}<pitch>${pitchXml(n)}</pitch><duration>4</duration><voice>1</voice><type>whole</type>${
          n.alter ? `<accidental>${n.alter > 0 ? 'sharp' : 'flat'}</accidental>` : ''
        }</note>`
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name></part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time print-object="no"><beats>4</beats><beat-type>4</beat-type></time><clef>${clef}</clef></attributes>${notes}</measure></part></score-partwise>`
}

/** An arpeggio: eighth notes beamed by four, accidentals once per measure. */
function sequenceXml(q: NoteQuestion, clef: string): string {
  const shown = new Map<string, number>()
  const notes = q.notes
    .map((n, i) => {
      const where = `${n.step}${n.octave}`
      const sign =
        (shown.get(where) ?? 0) !== n.alter
          ? `<accidental>${{ [-1]: 'flat', 0: 'natural', 1: 'sharp' }[n.alter]}</accidental>`
          : ''
      shown.set(where, n.alter)
      const k = i % 4
      const last = i === q.notes.length - 1 || k === 3
      const beam =
        q.notes.length - (i - k) < 2 ? '' : `<beam number="1">${k === 0 ? 'begin' : last ? 'end' : 'continue'}</beam>`
      return `<note><pitch>${pitchXml(n)}</pitch><duration>1</duration><voice>1</voice><type>eighth</type>${sign}${beam}</note>`
    })
    .join('')
  const beats = Math.ceil(q.notes.length / 2)
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name></part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>2</divisions><key><fifths>0</fifths></key><time print-object="no"><beats>${beats}</beats><beat-type>4</beat-type></time><clef>${clef}</clef></attributes>${notes}</measure></part></score-partwise>`
}

/** Rhythm events for the Rust transport (silent; only the timing is judged). */
export function rhythmEvents(rhythm: readonly RhythmNote[], bpm: number) {
  const q = 60000 / bpm
  return rhythm
    .filter((n) => !n.rest)
    .map((n, i) => ({
      noteId: `rhythm-${i}`,
      pitch: 72,
      onsetMs: n.start * q,
      durMs: n.length * q * 0.9,
      velocity: 80,
      staff: 1,
      measure: Math.floor(n.start / 4) + 1
    }))
}

/** One click per beat for the two measures, accent on each downbeat. */
export function rhythmClicks(bpm: number) {
  const q = 60000 / bpm
  return Array.from({ length: 8 }, (_, i) => ({ ms: i * q, accent: i % 4 === 0 }))
}
