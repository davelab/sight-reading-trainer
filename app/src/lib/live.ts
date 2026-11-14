/**
 * Live analysis while the student plays ("Componi"): the chord under the hands,
 * the key of the last bars, the tempo. Display only: recording and its timing
 * are done in the Rust core.
 */

const NAMES_IT = ['Do', 'Do♯', 'Re', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si']
const NAMES_FLAT_IT = ['Do', 'Re♭', 'Re', 'Mi♭', 'Mi', 'Fa', 'Sol♭', 'Sol', 'La♭', 'La', 'Si♭', 'Si']

interface Template {
  suffix: string
  intervals: number[]
  /** Small preference among equal matches: simple chords first. */
  weight: number
}

const TEMPLATES: Template[] = [
  { suffix: '', intervals: [0, 4, 7], weight: 0.3 },
  { suffix: 'm', intervals: [0, 3, 7], weight: 0.3 },
  { suffix: '7', intervals: [0, 4, 7, 10], weight: 0.2 },
  { suffix: 'maj7', intervals: [0, 4, 7, 11], weight: 0.1 },
  { suffix: 'm7', intervals: [0, 3, 7, 10], weight: 0.2 },
  { suffix: 'm7♭5', intervals: [0, 3, 6, 10], weight: 0.1 },
  { suffix: 'dim', intervals: [0, 3, 6], weight: 0.1 },
  { suffix: 'dim7', intervals: [0, 3, 6, 9], weight: 0.1 },
  { suffix: 'aum', intervals: [0, 4, 8], weight: 0 },
  { suffix: 'sus4', intervals: [0, 5, 7], weight: 0 },
  { suffix: 'sus2', intervals: [0, 2, 7], weight: 0 },
  { suffix: '5', intervals: [0, 7], weight: 0 }
]

export interface LiveChord {
  /** "Rem7", "Do/Mi". */
  name: string
  root: number
  suffix: string
  bass: number
}

/** The chord of the keys sounding now; null for fewer than two pitch classes or no match. */
export function chordOf(pitches: readonly number[], flats = false): LiveChord | null {
  const pcs = [...new Set(pitches.map((p) => ((p % 12) + 12) % 12))]
  if (pcs.length < 2) return null
  const bass = ((Math.min(...pitches) % 12) + 12) % 12
  let best: { score: number; root: number; t: Template } | null = null
  for (let root = 0; root < 12; root++) {
    for (const t of TEMPLATES) {
      const chord = t.intervals.map((i) => (root + i) % 12)
      const hit = pcs.filter((p) => chord.includes(p)).length
      const extra = pcs.length - hit
      const missing = chord.length - hit
      if (missing > (chord.length >= 4 ? 1 : 0) || hit < 2) continue
      // A missing fifth is common; a missing third or root is not.
      if (missing === 1 && !pcs.includes(root)) continue
      const score = hit - 1.5 * extra - 0.6 * missing + t.weight + (root === bass ? 0.4 : 0)
      if (!best || score > best.score) best = { score, root, t }
    }
  }
  if (!best || best.score < 1.5) return null
  const names = flats ? NAMES_FLAT_IT : NAMES_IT
  const name = names[best.root] + best.t.suffix + (bass !== best.root ? `/${names[bass]}` : '')
  return { name, root: best.root, suffix: best.t.suffix, bass }
}

// Krumhansl–Kessler key profiles (major, minor), from C.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

function correlation(a: readonly number[], b: readonly number[]): number {
  const ma = a.reduce((s, x) => s + x, 0) / a.length
  const mb = b.reduce((s, x) => s + x, 0) / b.length
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db += (b[i] - mb) ** 2
  }
  return da && db ? num / Math.sqrt(da * db) : 0
}

export interface LiveKey {
  tonic: number
  mode: 'major' | 'minor'
  /** "Re minore". */
  name: string
  /** Correlation of the best key, 0..1. */
  confidence: number
}

/** Key of a pitch-class weight histogram (Krumhansl–Schmuckler). */
export function keyOf(histogram: readonly number[]): LiveKey | null {
  if (histogram.reduce((s, x) => s + x, 0) <= 0) return null
  let best: LiveKey | null = null
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const [mode, profile] of [
      ['major', MAJOR],
      ['minor', MINOR]
    ] as const) {
      const rotated = histogram.map((_, i) => histogram[(i + tonic) % 12])
      const r = correlation(rotated, profile)
      if (!best || r > best.confidence) {
        const flats = [5, 10, 3, 8, 1, 6].includes(mode === 'major' ? tonic : (tonic + 3) % 12)
        const names = flats ? NAMES_FLAT_IT : NAMES_IT
        best = { tonic, mode, name: `${names[tonic]} ${mode === 'major' ? 'maggiore' : 'minore'}`, confidence: r }
      }
    }
  }
  return best
}

/**
 * Pitch-class weights of the last bars: each note counts for how long it
 * sounds, older music fades with a half-life of `halfLifeMs`.
 */
export class KeyTracker {
  private weights = new Array(12).fill(0)
  private last = 0
  constructor(private halfLifeMs = 15000) {}

  /** A note sounded for `durationMs`, ending at `atMs`. */
  add(pitch: number, durationMs: number, atMs: number): void {
    this.decay(atMs)
    this.weights[((pitch % 12) + 12) % 12] += Math.min(durationMs, 4000) / 1000 + 0.1
  }

  private decay(atMs: number): void {
    if (this.last && atMs > this.last) {
      const f = 0.5 ** ((atMs - this.last) / this.halfLifeMs)
      this.weights = this.weights.map((w) => w * f)
    }
    this.last = atMs
  }

  key(): LiveKey | null {
    return keyOf(this.weights)
  }

  reset(): void {
    this.weights.fill(0)
    this.last = 0
  }
}

/**
 * Tempo from the last onsets (ms): attacks within 60 ms are one; the common
 * gap between attacks, folded into a beat of 0.4–1.0 s (60–150 bpm). Null with
 * too few attacks.
 */
export function tempoOf(onsetsMs: readonly number[]): number | null {
  const attacks: number[] = []
  for (const t of [...onsetsMs].sort((a, b) => a - b)) {
    if (!attacks.length || t - attacks[attacks.length - 1] > 60) attacks.push(t)
  }
  const recent = attacks.slice(-17)
  if (recent.length < 5) return null
  const gaps = recent
    .slice(1)
    .map((t, i) => t - recent[i])
    .filter((g) => g > 80 && g < 2500)
  if (gaps.length < 4) return null
  // The smallest frequent gap is the subdivision; fold it to a beat-sized value.
  const sorted = [...gaps].sort((a, b) => a - b)
  let beat = sorted[Math.floor(sorted.length * 0.35)]
  while (beat < 400) beat *= 2
  while (beat > 1000) beat /= 2
  return Math.round(60000 / beat)
}
