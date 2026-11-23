/**
 * Sight-reading practice helpers (pure functions, tested):
 * - metronome beats for the loaded score, and the count-in at a position;
 * - note spelling from Verovio's MEI, for note names and intervals on the score;
 * - judging a run of "A tempo" mode and suggesting the next tempo.
 */
import type { MeasureStart } from './timemap'

export interface Meter {
  count: number
  unit: number
}

export interface Click {
  ms: number
  accent: boolean
}

/** Time signature in force at every measure (index = ordinal - 1), from the MEI. */
export function metersFromMei(mei: string): Meter[] {
  const out: Meter[] = []
  let meter: Meter = { count: 4, unit: 4 }
  const tag = /<(measure|meterSig|scoreDef|staffDef)\b([^>]*)>/g
  for (let m = tag.exec(mei); m; m = tag.exec(mei)) {
    const [, name, attrs] = m
    if (name === 'measure') {
      out.push(meter)
      continue
    }
    const count = Number(/\b(?:meter\.)?count="(\d+)/.exec(attrs)?.[1])
    const unit = Number(/\b(?:meter\.)?unit="(\d+)"/.exec(attrs)?.[1])
    if (count > 0 && unit > 0) meter = { count, unit }
  }
  return out
}

/** Metronome beats per measure: compound meters (6/8, 9/8, 12/8) beat in dotted quarters. */
export function beatsPerMeasure(meter: Meter): number {
  return meter.unit === 8 && meter.count % 3 === 0 && meter.count > 3 ? meter.count / 3 : meter.count
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

/**
 * Metronome clicks in performance order (score ms). Full measures are divided
 * evenly, accent on the first beat; a shorter measure (a pickup, or the last
 * one) gets the beats that fit, counted back from its end.
 */
export function metronomeClicks(
  measures: readonly MeasureStart[],
  measureIds: readonly string[],
  meters: readonly Meter[],
  durationMs: number
): Click[] {
  const ordinal = new Map(measureIds.map((id, i) => [id, i]))
  const spans = measures.map((m, i) => {
    const end = i + 1 < measures.length ? measures[i + 1].ms : durationMs
    const meter = meters[ordinal.get(m.measureId) ?? -1] ?? { count: 4, unit: 4 }
    return { start: m.ms, end, beats: beatsPerMeasure(meter) }
  })
  // Typical beat length, from the measures' own lengths (most are full).
  const beatMs = median(spans.filter((s) => s.end > s.start).map((s) => (s.end - s.start) / s.beats))
  const out: Click[] = []
  for (const s of spans) {
    const length = s.end - s.start
    if (length <= 0 || beatMs <= 0) continue
    const fits = Math.max(1, Math.round(length / beatMs))
    if (fits >= s.beats) {
      for (let i = 0; i < s.beats; i++) out.push({ ms: s.start + (i * length) / s.beats, accent: i === 0 })
    } else {
      for (let j = fits; j >= 1; j--) out.push({ ms: s.end - j * beatMs, accent: false })
    }
  }
  return out.filter((c) => c.ms >= 0)
}

/** Count-in for a start at `positionMs`: one measure of the meter there, at its beat length. */
export function countInAt(clicks: readonly Click[], positionMs: number): { beats: number; beatMs: number } | null {
  const i = clicks.findIndex((c) => c.ms >= positionMs - 1)
  if (i < 0) return null
  let next = clicks.slice(i + 1).findIndex((c) => c.accent)
  next = next < 0 ? clicks.length : i + 1 + next
  const first = clicks[i].accent
    ? i
    : Math.max(
        0,
        clicks
          .slice(0, i)
          .map((c) => c.accent)
          .lastIndexOf(true)
      )
  const measure = clicks.slice(first, next)
  if (measure.length < 2) return null
  return { beats: measure.length, beatMs: (measure[measure.length - 1].ms - measure[0].ms) / (measure.length - 1) }
}

// --- Note spelling ---------------------------------------------------------------

export interface Spelling {
  /** Diatonic step 0-6 (C..B) and octave, as written. */
  step: number
  octave: number
}

const STEPS = 'cdefgab'
const STEP_PC = [0, 2, 4, 5, 7, 9, 11]
const ITALIAN = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si']

/** Written step and octave of every note (xml:id), from Verovio's MEI. */
export function spellingsFromMei(mei: string): Map<string, Spelling> {
  const map = new Map<string, Spelling>()
  for (const m of mei.matchAll(/<note\b([^>]*)>/g)) {
    const attrs = m[1]
    const id = /\bxml:id="([^"]+)"/.exec(attrs)?.[1]
    const pname = /\bpname="([a-g])"/.exec(attrs)?.[1]
    const oct = /\boct="(-?\d+)"/.exec(attrs)?.[1]
    if (id && pname && oct !== undefined) map.set(id, { step: STEPS.indexOf(pname), octave: Number(oct) })
  }
  return map
}

/** "Fa♯" from the written step and the sounding pitch. */
export function noteName(spelling: Spelling, midi: number): string {
  const natural = 12 * (spelling.octave + 1) + STEP_PC[spelling.step]
  const alter = midi - natural
  const sign = { [-2]: '𝄫', [-1]: '♭', 0: '', 1: '♯', 2: '𝄪' }[alter] ?? ''
  return ITALIAN[spelling.step] + sign
}

/** Diatonic interval between two written notes: 1 unison, 2 second... signed by direction. */
export function diatonicInterval(a: Spelling, b: Spelling): number {
  const steps = b.octave * 7 + b.step - (a.octave * 7 + a.step)
  return steps >= 0 ? steps + 1 : steps - 1
}

/** "3↑", "5↓", "=" for a repeated note. */
export function intervalLabel(interval: number): string {
  if (interval === 1 || interval === -1) return '='
  return `${Math.abs(interval)}${interval > 0 ? '↑' : '↓'}`
}

/**
 * Shape of a chord from its written notes, lowest first: a triad in root
 * position ("fond."), first or second inversion, a seventh chord ("7ª"); null
 * for anything else (clusters, open voicings, octaves only).
 */
export function chordShape(notes: readonly Spelling[]): string | null {
  const steps = [...new Set(notes.map((n) => (n.step + 7 * 100) % 7))]
  if (steps.length < 3) return null
  const bass = notes.reduce((lo, n) => (n.octave * 7 + n.step < lo.octave * 7 + lo.step ? n : lo)).step
  // Find a root such that the steps are root, 3rd, 5th (and 7th).
  for (const root of steps) {
    const rel = new Set(steps.map((s) => (s - root + 7) % 7))
    const triad = rel.has(0) && rel.has(2) && rel.has(4)
    if (!triad) continue
    if (rel.size === 3) {
      const inv = (bass - root + 7) % 7
      return inv === 0 ? 'fond.' : inv === 2 ? '1° riv.' : '2° riv.'
    }
    if (rel.size === 4 && rel.has(6)) return '7ª'
  }
  return null
}

// --- Judging a run ---------------------------------------------------------------

export interface TimedTotals {
  correct: number
  early: number
  late: number
  wrong: number
  missed: number
  expected: number
  meanOffsetMs: number
  measures: number
}

export interface RunVerdict {
  /** Notes played right (any timing) out of those expected plus wrong ones. */
  notes: number
  /** Of the right notes, the share on time. */
  onTime: number
  /** Next tempo to try, in percent (25-200). */
  nextTempo: number
  advice: string
}

export function judgeRun(t: TimedTotals, tempoPercent: number): RunVerdict {
  const hit = t.correct + t.early + t.late
  const notes = t.expected + t.wrong ? hit / (t.expected + t.wrong) : 0
  const onTime = hit ? t.correct / hit : 0
  const clamp = (p: number) => Math.min(200, Math.max(25, Math.round(p / 5) * 5))
  if (notes >= 0.9 && onTime >= 0.8) {
    return { notes, onTime, nextTempo: clamp(tempoPercent + 10), advice: 'Ottimo: prova un po’ più veloce.' }
  }
  if (notes < 0.7) {
    return {
      notes,
      onTime,
      nextTempo: clamp(tempoPercent - 10),
      advice: 'Troppe note perse o sbagliate: rallenta e non fermarti.'
    }
  }
  const drift =
    Math.abs(t.meanOffsetMs) > 40 ? (t.meanOffsetMs > 0 ? ' Tendi a suonare in ritardo.' : ' Tendi ad anticipare.') : ''
  return { notes, onTime, nextTempo: clamp(tempoPercent), advice: `Buono: ripeti allo stesso tempo.${drift}` }
}
