import type { TranscribeHints } from '../../types'

/** What the form holds: '' means «automatico». */
export interface HintForm {
  tempo: string
  meter: '' | '2' | '3' | '4'
  key: string
  pickup: '' | '0' | '1' | '2' | '3'
}

export const EMPTY_FORM: HintForm = { tempo: '', meter: '', key: '', pickup: '' }

const TONICS: [string, string][] = [
  ['C', 'Do'],
  ['C#', 'Do♯'],
  ['Db', 'Re♭'],
  ['D', 'Re'],
  ['Eb', 'Mi♭'],
  ['E', 'Mi'],
  ['F', 'Fa'],
  ['F#', 'Fa♯'],
  ['Gb', 'Sol♭'],
  ['G', 'Sol'],
  ['Ab', 'La♭'],
  ['A', 'La'],
  ['Bb', 'Si♭'],
  ['B', 'Si']
]
// Keys as written in scores (no Db minor, no Gb minor...).
const MINOR = new Set(['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'])

/** Engine value ('G major') and Italian label ('Sol maggiore') of every key. */
export const KEY_OPTIONS: { value: string; label: string }[] = [
  ...TONICS.map(([t, name]) => ({ value: `${t} major`, label: `${name} maggiore` })),
  ...TONICS.filter(([t]) => MINOR.has(t)).map(([t, name]) => ({ value: `${t} minor`, label: `${name} minore` }))
]

/** Only what the user filled in; the engine infers the rest. */
export function toHints(form: HintForm): TranscribeHints {
  const hints: TranscribeHints = {}
  const tempo = Number(form.tempo.replace(',', '.'))
  if (form.tempo.trim() && Number.isFinite(tempo) && tempo >= 20 && tempo <= 300) hints.tempo = Math.round(tempo)
  if (form.meter) hints.beatsPerMeasure = Number(form.meter)
  if (form.key) hints.key = form.key
  if (form.pickup) hints.pickupBeats = Number(form.pickup)
  return hints
}

/** Tempo from taps (ms timestamps): median of the last intervals; null until 3 taps. */
export function tapTempo(taps: number[]): number | null {
  const recent = taps.slice(-8)
  if (recent.length < 3) return null
  const gaps = recent
    .slice(1)
    .map((t, i) => t - recent[i])
    .sort((a, b) => a - b)
  const median = gaps[Math.floor(gaps.length / 2)]
  return median > 0 ? Math.round(60000 / median) : null
}

/** Taps further apart than this start a new count. */
export const TAP_RESET_MS = 2000
