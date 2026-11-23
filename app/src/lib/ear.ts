/**
 * Ear training (relative pitch): what to play and what the answers are.
 * - intervals, simple and compound, up, down or together;
 * - the colour of a chord (its quality), from triads to extended chords;
 * - the exact chord (root and quality), after a reference note.
 * Pure logic: the sound is played by the Rust synth from the events built here.
 */

export type Random = () => number

const pick = <T>(xs: readonly T[], rnd: Random): T => xs[Math.floor(rnd() * xs.length) % xs.length]

// --- Intervals ----------------------------------------------------------------------

export interface IntervalDef {
  id: string
  semitones: number
  name: string
  /** Short label for the answer button. */
  short: string
}

export const INTERVALS: IntervalDef[] = [
  { id: 'P1', semitones: 0, name: 'unisono', short: '1' },
  { id: 'm2', semitones: 1, name: '2ª minore', short: '2m' },
  { id: 'M2', semitones: 2, name: '2ª maggiore', short: '2M' },
  { id: 'm3', semitones: 3, name: '3ª minore', short: '3m' },
  { id: 'M3', semitones: 4, name: '3ª maggiore', short: '3M' },
  { id: 'P4', semitones: 5, name: '4ª giusta', short: '4' },
  { id: 'TT', semitones: 6, name: 'tritono (4ª eccedente / 5ª diminuita)', short: 'tritono' },
  { id: 'P5', semitones: 7, name: '5ª giusta', short: '5' },
  { id: 'm6', semitones: 8, name: '6ª minore', short: '6m' },
  { id: 'M6', semitones: 9, name: '6ª maggiore', short: '6M' },
  { id: 'm7', semitones: 10, name: '7ª minore', short: '7m' },
  { id: 'M7', semitones: 11, name: '7ª maggiore', short: '7M' },
  { id: 'P8', semitones: 12, name: 'ottava', short: '8' },
  { id: 'm9', semitones: 13, name: '9ª minore', short: '9m' },
  { id: 'M9', semitones: 14, name: '9ª maggiore', short: '9M' },
  { id: 'm10', semitones: 15, name: '10ª minore', short: '10m' },
  { id: 'M10', semitones: 16, name: '10ª maggiore', short: '10M' },
  { id: 'P11', semitones: 17, name: '11ª giusta', short: '11' },
  { id: 'A11', semitones: 18, name: '11ª eccedente', short: '11+' },
  { id: 'P12', semitones: 19, name: '12ª giusta', short: '12' },
  { id: 'm13', semitones: 20, name: '13ª minore', short: '13m' },
  { id: 'M13', semitones: 21, name: '13ª maggiore', short: '13M' }
]

/** Ready-made sets of intervals, from the first ones to learn to all of them. */
export const INTERVAL_SETS: { id: string; name: string; ids: string[] }[] = [
  { id: 'first', name: 'Primi: 2ª, 3ª, 5ª, 8ª', ids: ['M2', 'M3', 'P5', 'P8'] },
  { id: 'major', name: 'Della scala maggiore', ids: ['M2', 'M3', 'P4', 'P5', 'M6', 'M7', 'P8'] },
  {
    id: 'simple',
    name: 'Tutti i semplici',
    ids: ['m2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8']
  },
  { id: 'compound', name: 'Composti (9ª–13ª)', ids: ['m9', 'M9', 'm10', 'M10', 'P11', 'A11', 'P12', 'm13', 'M13'] },
  { id: 'all', name: 'Tutti, anche i composti', ids: INTERVALS.map((i) => i.id) }
]

export type IntervalDirection = 'up' | 'down' | 'harmonic' | 'mixed'

// --- Chords ---------------------------------------------------------------------------

export interface ChordDef {
  id: string
  /** Italian name of the quality: "maggiore", "settima di dominante". */
  name: string
  /** Suffix after the root: "", "m", "7", "maj7". */
  symbol: string
  /** Semitones from the root, in the voicing played (root position). */
  intervals: number[]
  group: 'triads' | 'sevenths' | 'extended'
}

export const CHORDS: ChordDef[] = [
  { id: 'maj', name: 'maggiore', symbol: '', intervals: [0, 4, 7], group: 'triads' },
  { id: 'min', name: 'minore', symbol: 'm', intervals: [0, 3, 7], group: 'triads' },
  { id: 'dim', name: 'diminuito', symbol: 'dim', intervals: [0, 3, 6], group: 'triads' },
  { id: 'aug', name: 'aumentato', symbol: 'aum', intervals: [0, 4, 8], group: 'triads' },
  { id: 'sus2', name: 'sospeso di 2ª (sus2)', symbol: 'sus2', intervals: [0, 2, 7], group: 'triads' },
  { id: 'sus4', name: 'sospeso di 4ª (sus4)', symbol: 'sus4', intervals: [0, 5, 7], group: 'triads' },
  { id: 'dom7', name: 'settima di dominante', symbol: '7', intervals: [0, 4, 7, 10], group: 'sevenths' },
  { id: 'maj7', name: 'settima maggiore', symbol: 'maj7', intervals: [0, 4, 7, 11], group: 'sevenths' },
  { id: 'min7', name: 'minore settima', symbol: 'm7', intervals: [0, 3, 7, 10], group: 'sevenths' },
  { id: 'm7b5', name: 'semidiminuito (m7♭5)', symbol: 'm7♭5', intervals: [0, 3, 6, 10], group: 'sevenths' },
  { id: 'dim7', name: 'settima diminuita', symbol: 'dim7', intervals: [0, 3, 6, 9], group: 'sevenths' },
  { id: 'mMaj7', name: 'minore con 7ª maggiore', symbol: 'm(maj7)', intervals: [0, 3, 7, 11], group: 'sevenths' },
  { id: '7sus4', name: 'settima sospesa (7sus4)', symbol: '7sus4', intervals: [0, 5, 7, 10], group: 'sevenths' },
  { id: '6', name: 'sesta', symbol: '6', intervals: [0, 4, 7, 9], group: 'extended' },
  { id: 'm6', name: 'minore sesta', symbol: 'm6', intervals: [0, 3, 7, 9], group: 'extended' },
  { id: 'add9', name: 'maggiore con 9ª (add9)', symbol: 'add9', intervals: [0, 4, 7, 14], group: 'extended' },
  { id: 'dom9', name: 'nona di dominante', symbol: '9', intervals: [0, 4, 7, 10, 14], group: 'extended' },
  { id: 'maj9', name: 'nona maggiore', symbol: 'maj9', intervals: [0, 4, 7, 11, 14], group: 'extended' },
  { id: 'min9', name: 'minore nona', symbol: 'm9', intervals: [0, 3, 7, 10, 14], group: 'extended' },
  { id: '7b9', name: 'settima con 9ª minore (7♭9)', symbol: '7♭9', intervals: [0, 4, 7, 10, 13], group: 'extended' },
  { id: 'dom11', name: 'undicesima (9sus4)', symbol: '11', intervals: [0, 7, 10, 14, 17], group: 'extended' },
  { id: 'dom13', name: 'tredicesima di dominante', symbol: '13', intervals: [0, 4, 10, 14, 21], group: 'extended' },
  {
    id: 'maj7s11',
    name: 'settima maggiore con 11ª eccedente',
    symbol: 'maj7♯11',
    intervals: [0, 4, 7, 11, 18],
    group: 'extended'
  }
]

export const CHORD_GROUPS = [
  { id: 'triads', name: 'Triadi: maggiore, minore, diminuito, aumentato, sus2, sus4' },
  { id: 'sevenths', name: 'Settime: 7, maj7, m7, m7♭5, dim7, m(maj7), 7sus4' },
  { id: 'extended', name: 'Sesta, nona, undicesima, tredicesima, add9' }
] as const

export type ChordGroup = (typeof CHORD_GROUPS)[number]['id']

const ROOTS = ['Do', 'Re♭', 'Re', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si']
export const ROOT_NAMES = ROOTS

export function chordName(root: number, chord: ChordDef): string {
  return `${ROOTS[((root % 12) + 12) % 12]} ${chord.name}`
}

// --- Questions ------------------------------------------------------------------------

export type EarMode = 'intervals' | 'quality' | 'exact'

export interface EarQuestion {
  mode: EarMode
  /** Pitches in the order and grouping they sound: each inner list sounds together. */
  sound: number[][]
  /** What the answer must be: an interval id, a chord id, or "root:chordId". */
  answer: string
  /** The sentence shown after answering. */
  explanation: string
  /** A note played before the question (exact chord: the reference Do). */
  reference?: number
}

const NOTE_NAMES = ['Do', 'Do♯', 'Re', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si']
const noteName = (p: number) => `${NOTE_NAMES[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`

export function nextInterval(
  ids: readonly string[],
  direction: IntervalDirection,
  previous: EarQuestion | null,
  rnd: Random = Math.random
): EarQuestion {
  const pool = INTERVALS.filter((i) => ids.includes(i.id))
  const choices = pool.length ? pool : INTERVALS.filter((i) => i.id === 'P5')
  let def = pick(choices, rnd)
  if (previous && choices.length > 1 && previous.answer === def.id) def = pick(choices, rnd)
  const dir = direction === 'mixed' ? pick(['up', 'down', 'harmonic'] as const, rnd) : direction
  // Somewhere comfortable: both notes between C3 and C6.
  const span = def.semitones
  const low = 48 + Math.floor(rnd() * Math.max(1, 84 - 48 - span))
  const high = low + span
  const sound = dir === 'harmonic' ? [[low, high]] : dir === 'up' ? [[low], [high]] : [[high], [low]]
  const how = dir === 'harmonic' ? 'insieme' : dir === 'up' ? 'ascendente' : 'discendente'
  const [a, b] = dir === 'down' ? [high, low] : [low, high]
  return {
    mode: 'intervals',
    sound,
    answer: def.id,
    explanation: `${def.name[0].toUpperCase()}${def.name.slice(1)} ${how}: ${noteName(a)} – ${noteName(b)}`
  }
}

/** A chord voiced from its root (optionally inverted: the lowest note moves up an octave). */
export function voice(root: number, chord: ChordDef, inversion = 0): number[] {
  const notes = chord.intervals.map((i) => root + i)
  for (let k = 0; k < inversion && k < notes.length - 1; k++) notes.push((notes.shift() as number) + 12)
  return notes.sort((a, b) => a - b)
}

export interface ChordOptions {
  groups: readonly ChordGroup[]
  /** Play triads and sevenths in any inversion, not only in root position. */
  inversions: boolean
  /** Arpeggiate (one note after the other, then together) instead of only a block. */
  arpeggiate: boolean
}

function chordPool(groups: readonly ChordGroup[]): ChordDef[] {
  const pool = CHORDS.filter((c) => groups.includes(c.group))
  return pool.length ? pool : CHORDS.filter((c) => c.group === 'triads')
}

export function nextChord(
  mode: 'quality' | 'exact',
  o: ChordOptions,
  previous: EarQuestion | null,
  rnd: Random = Math.random
): EarQuestion {
  const pool = chordPool(o.groups)
  let chord = pick(pool, rnd)
  if (previous && pool.length > 1 && previous.answer.endsWith(chord.id) && mode === 'quality') chord = pick(pool, rnd)
  // Roots from F2 to E3 keep every voicing in a piano's warm middle.
  const root = 41 + Math.floor(rnd() * 12)
  const inversion = o.inversions && chord.group !== 'extended' ? Math.floor(rnd() * chord.intervals.length) : 0
  const notes = voice(root, chord, inversion)
  const sound = o.arpeggiate ? [...notes.map((n) => [n]), notes] : [notes]
  const pc = root % 12
  const position = inversion ? `, ${inversion}° rivolto` : ''
  return {
    mode,
    sound,
    answer: mode === 'exact' ? `${pc}:${chord.id}` : chord.id,
    explanation: `${chordName(pc, chord)}${position} (${ROOTS[pc]}${chord.symbol}): ${notes.map(noteName).join(' ')}`,
    reference: mode === 'exact' ? 60 : undefined
  }
}

// --- Sound for the transport ------------------------------------------------------------

/** Playback events: the reference note, then each group in turn (`gapMs` apart). */
export function earEvents(q: EarQuestion, gapMs = 900) {
  const events: {
    noteId: string
    pitch: number
    onsetMs: number
    durMs: number
    velocity: number
    staff: number
    measure: number
  }[] = []
  let t = 0
  if (q.reference !== undefined) {
    events.push({ noteId: 'ear-ref', pitch: q.reference, onsetMs: 0, durMs: 700, velocity: 70, staff: 1, measure: 1 })
    t = 1300
  }
  q.sound.forEach((group, g) => {
    const last = g === q.sound.length - 1
    const dur = last ? 1800 : gapMs * 0.9
    for (const pitch of group) {
      events.push({
        noteId: `ear-${g}-${pitch}`,
        pitch,
        onsetMs: t,
        durMs: dur,
        velocity: 82,
        staff: pitch < 60 ? 2 : 1,
        measure: 1
      })
    }
    t += gapMs
  })
  return events
}

// --- Statistics -------------------------------------------------------------------------

export interface EarStats {
  asked: number
  right: number
  streak: number
  best: number
  /** "given→correct" -> times. */
  confusions: Record<string, number>
}

export const NO_STATS: EarStats = { asked: 0, right: 0, streak: 0, best: 0, confusions: {} }

export function record(stats: EarStats, given: string, correct: string): EarStats {
  const ok = given === correct
  const streak = ok ? stats.streak + 1 : 0
  const confusions = { ...stats.confusions }
  if (!ok) confusions[`${given}→${correct}`] = (confusions[`${given}→${correct}`] ?? 0) + 1
  return {
    asked: stats.asked + 1,
    right: stats.right + (ok ? 1 : 0),
    streak,
    best: Math.max(stats.best, streak),
    confusions
  }
}

/** Human name of an answer id in a mode. */
export function answerName(mode: EarMode, id: string): string {
  if (mode === 'intervals') return INTERVALS.find((i) => i.id === id)?.name ?? id
  if (mode === 'quality') return CHORDS.find((c) => c.id === id)?.name ?? id
  const [root, chordId] = id.split(':')
  const chord = CHORDS.find((c) => c.id === chordId)
  return chord ? chordName(Number(root), chord) : id
}

/** The most frequent mix-ups, worst first: "3ª minore scambiata per 3ª maggiore: 4 volte". */
export function topConfusions(stats: EarStats, mode: EarMode, count = 3): string[] {
  return Object.entries(stats.confusions)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([key, times]) => {
      const [given, correct] = key.split('→')
      return `${answerName(mode, correct)} scambiata per ${answerName(mode, given)}: ${times} ${times === 1 ? 'volta' : 'volte'}`
    })
}
