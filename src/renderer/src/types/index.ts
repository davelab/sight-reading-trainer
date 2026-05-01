export type Clef = 'treble' | 'bass'

export type NoteDuration = 'w' | 'h' | 'q'

export type NoteResult = 'correct' | 'incorrect' | 'missed' | null

export interface ScaleNote {
  pitch: string     // Scientific: "C4"
  vexKey: string    // VexFlow key: "c/4"
  midi: number      // MIDI number: 60
}

export interface MelodyNote {
  id: string
  pitch: string
  vexKey: string
  midi: number
  duration: NoteDuration
  durationBeats: number  // w=4, h=2, q=1
  measureIndex: number
}

export interface Melody {
  notes: MelodyNote[]
  clef: Clef
  numMeasures: number
}

export interface SessionNote {
  noteId: string
  expected: string
  played: string | null
  pitchCorrect: boolean
  timingOffsetMs: number
  rhythmCorrect: boolean
}

export interface PracticeSession {
  id: string
  date: string
  bpm: number
  clef: Clef
  numMeasures: number
  totalNotes: number
  correctPitch: number
  correctRhythm: number
  pitchAccuracy: number
  rhythmAccuracy: number
  notes: SessionNote[]
}

export type PracticeState = 'idle' | 'listening' | 'countdown' | 'practicing' | 'finished'

export interface PracticeStatus {
  state: PracticeState
  activeNoteIndex: number
  noteResults: NoteResult[]
  countdownBeat: number
  sessionNotes: SessionNote[]
}
