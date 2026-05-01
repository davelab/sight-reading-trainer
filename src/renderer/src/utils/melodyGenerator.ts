import type { Clef, MelodyNote, Melody, NoteDuration, ScaleNote } from '../types'

const TREBLE_SCALE: ScaleNote[] = [
  { pitch: 'C4', vexKey: 'c/4', midi: 60 },
  { pitch: 'D4', vexKey: 'd/4', midi: 62 },
  { pitch: 'E4', vexKey: 'e/4', midi: 64 },
  { pitch: 'F4', vexKey: 'f/4', midi: 65 },
  { pitch: 'G4', vexKey: 'g/4', midi: 67 },
  { pitch: 'A4', vexKey: 'a/4', midi: 69 },
  { pitch: 'B4', vexKey: 'b/4', midi: 71 },
  { pitch: 'C5', vexKey: 'c/5', midi: 72 },
  { pitch: 'D5', vexKey: 'd/5', midi: 74 },
  { pitch: 'E5', vexKey: 'e/5', midi: 76 },
]

const BASS_SCALE: ScaleNote[] = [
  { pitch: 'C3', vexKey: 'c/3', midi: 48 },
  { pitch: 'D3', vexKey: 'd/3', midi: 50 },
  { pitch: 'E3', vexKey: 'e/3', midi: 52 },
  { pitch: 'F3', vexKey: 'f/3', midi: 53 },
  { pitch: 'G3', vexKey: 'g/3', midi: 55 },
  { pitch: 'A3', vexKey: 'a/3', midi: 57 },
  { pitch: 'B3', vexKey: 'b/3', midi: 59 },
  { pitch: 'C4', vexKey: 'c/4', midi: 60 },
  { pitch: 'D4', vexKey: 'd/4', midi: 62 },
  { pitch: 'E4', vexKey: 'e/4', midi: 64 },
]

interface DurationOption {
  duration: NoteDuration
  beats: number
  weight: number
}

const DURATIONS: DurationOption[] = [
  { duration: 'q', beats: 1, weight: 55 },
  { duration: 'h', beats: 2, weight: 30 },
  { duration: 'w', beats: 4, weight: 15 },
]

function pickDuration(beatsLeft: number): DurationOption {
  const available = DURATIONS.filter(d => d.beats <= beatsLeft)
  if (available.length === 0) return DURATIONS[0]

  const totalWeight = available.reduce((sum, d) => sum + d.weight, 0)
  let rand = Math.random() * totalWeight
  for (const d of available) {
    rand -= d.weight
    if (rand <= 0) return d
  }
  return available[available.length - 1]
}

function pickInterval(): number {
  const rand = Math.random()
  if (rand < 0.10) return -3
  if (rand < 0.25) return -2
  if (rand < 0.42) return -1
  if (rand < 0.47) return 0
  if (rand < 0.64) return 1
  if (rand < 0.80) return 2
  return 3
}

export function generateMelody(clef: Clef, numMeasures: number = 2): Melody {
  const scale = clef === 'treble' ? TREBLE_SCALE : BASS_SCALE
  const notes: MelodyNote[] = []
  const beatsPerMeasure = 4

  // Start in the middle third of the scale
  const midStart = Math.floor(scale.length / 4)
  const midEnd = Math.floor((scale.length * 3) / 4)
  let currentIdx = midStart + Math.floor(Math.random() * (midEnd - midStart))

  for (let measure = 0; measure < numMeasures; measure++) {
    let beatsLeft = beatsPerMeasure

    while (beatsLeft > 0) {
      const dur = pickDuration(beatsLeft)
      const interval = pickInterval()
      currentIdx = Math.max(0, Math.min(scale.length - 1, currentIdx + interval))

      const scaleNote = scale[currentIdx]
      notes.push({
        id: `${measure}-${beatsPerMeasure - beatsLeft}-${Math.random().toString(36).slice(2, 7)}`,
        pitch: scaleNote.pitch,
        vexKey: scaleNote.vexKey,
        midi: scaleNote.midi,
        duration: dur.duration,
        durationBeats: dur.beats,
        measureIndex: measure,
      })

      beatsLeft -= dur.beats
    }
  }

  return { notes, clef, numMeasures }
}

export function midiToNoteName(midi: number): string {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const octave = Math.floor(midi / 12) - 1
  return `${noteNames[midi % 12]}${octave}`
}
