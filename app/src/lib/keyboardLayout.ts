/**
 * Geometry of the 88-key keyboard, shared by the on-screen keyboard and the
 * falling-notes view so the bars land exactly on their keys.
 * Positions are fractions of the keyboard width (0–1).
 */

export const LOW = 21 // A0
export const HIGH = 108 // C8
const WHITE_PCS = new Set([0, 2, 4, 5, 7, 9, 11])

export const isWhite = (pitch: number) => WHITE_PCS.has(((pitch % 12) + 12) % 12)

export interface KeyGeometry {
  pitch: number
  white: boolean
  left: number
  width: number
}

const WHITES = Array.from({ length: HIGH - LOW + 1 }, (_, i) => LOW + i).filter(isWhite)
const WHITE_WIDTH = 1 / WHITES.length

export const KEYS: KeyGeometry[] = Array.from({ length: HIGH - LOW + 1 }, (_, i) => {
  const pitch = LOW + i
  const whitesBelow = WHITES.filter((w) => w < pitch).length
  return isWhite(pitch)
    ? { pitch, white: true, left: whitesBelow * WHITE_WIDTH, width: WHITE_WIDTH }
    : { pitch, white: false, left: whitesBelow * WHITE_WIDTH - WHITE_WIDTH * 0.3, width: WHITE_WIDTH * 0.6 }
})

const BY_PITCH = new Map(KEYS.map((k) => [k.pitch, k]))

export function keyAt(pitch: number): KeyGeometry | undefined {
  return BY_PITCH.get(pitch)
}

const IT_NAMES = ['Do', 'Do♯', 'Re', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si']

/** "Do", "Fa♯"…; with `octave`, "Do4". */
export function noteLabel(pitch: number, octave = false): string {
  const name = IT_NAMES[((pitch % 12) + 12) % 12]
  return octave ? `${name}${Math.floor(pitch / 12) - 1}` : name
}
