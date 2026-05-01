import * as Tone from 'tone'
import type { MelodyNote } from '../types'

let audioStarted = false

export async function ensureAudioStarted(): Promise<void> {
  if (!audioStarted) {
    await Tone.start()
    audioStarted = true
  }
}

const DURATION_TONE: Record<string, string> = {
  w: '1n',
  h: '2n',
  q: '4n',
}

class AudioEngineImpl {
  private melodySynth: Tone.PolySynth
  private clickHigh: Tone.Synth
  private clickLow: Tone.Synth
  private metronomeLoop: Tone.Sequence | null = null
  private beatCallback: ((beat: number) => void) | null = null
  private beat = 0

  constructor() {
    this.melodySynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.02, decay: 0.1, sustain: 0.6, release: 0.8 },
      volume: -6,
    }).toDestination()

    this.clickHigh = new Tone.Synth({
      oscillator: { type: 'square' },
      envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.04 },
      volume: -10,
    }).toDestination()

    this.clickLow = new Tone.Synth({
      oscillator: { type: 'square' },
      envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.04 },
      volume: -14,
    }).toDestination()
  }

  setBpm(bpm: number): void {
    Tone.getTransport().bpm.value = bpm
  }

  startMetronome(bpm: number, onBeat: (beat: number) => void): void {
    this.stopAll()
    this.beatCallback = onBeat
    this.beat = 0
    Tone.getTransport().bpm.value = bpm

    this.metronomeLoop = new Tone.Sequence(
      (time, beatNum) => {
        const isDownbeat = beatNum === 0
        const synth = isDownbeat ? this.clickHigh : this.clickLow
        synth.triggerAttackRelease(isDownbeat ? 'C6' : 'G5', '32n', time)

        Tone.getDraw().schedule(() => {
          if (this.beatCallback) this.beatCallback(beatNum as number)
        }, time)
      },
      [0, 1, 2, 3],
      '4n'
    )

    this.metronomeLoop.start(0)
    Tone.getTransport().start()
  }

  async playReference(notes: MelodyNote[], bpm: number): Promise<void> {
    this.stopAll()
    await ensureAudioStarted()
    Tone.getTransport().bpm.value = bpm

    let beatPos = 0
    for (const note of notes) {
      const duration = DURATION_TONE[note.duration] ?? '4n'
      const time = Tone.Time('4n').toSeconds() * beatPos
      this.melodySynth.triggerAttackRelease(note.pitch, duration, `+${time}`)
      beatPos += note.durationBeats
    }
  }

  async startPracticeWithMetronome(
    bpm: number,
    onBeat: (beat: number) => void,
    onNoteExpected: (noteIndex: number, expectedTimeMs: number) => void,
    notes: MelodyNote[],
    countdownBeats: number = 4
  ): Promise<void> {
    this.stopAll()
    await ensureAudioStarted()
    this.beatCallback = onBeat
    this.beat = 0
    Tone.getTransport().bpm.value = bpm

    const beatSec = Tone.Time('4n').toSeconds()

    // Metronome loop (runs throughout countdown + practice)
    this.metronomeLoop = new Tone.Sequence(
      (time, beatNum) => {
        const isDownbeat = beatNum === 0
        const synth = isDownbeat ? this.clickHigh : this.clickLow
        synth.triggerAttackRelease(isDownbeat ? 'C6' : 'G5', '32n', time)
        Tone.getDraw().schedule(() => {
          if (this.beatCallback) this.beatCallback(beatNum as number)
        }, time)
      },
      [0, 1, 2, 3],
      '4n'
    )
    this.metronomeLoop.start(0)

    // Schedule note expectations after countdown
    let beatOffset = countdownBeats
    for (let i = 0; i < notes.length; i++) {
      const note = notes[i]
      const noteTime = beatOffset * beatSec
      const capturedIndex = i
      Tone.getTransport().scheduleOnce((time) => {
        const expectedTimeMs = Tone.getTransport().seconds * 1000
        Tone.getDraw().schedule(() => {
          onNoteExpected(capturedIndex, expectedTimeMs)
        }, time)
      }, noteTime)
      beatOffset += note.durationBeats
    }

    // Schedule end of practice
    Tone.getTransport().scheduleOnce(() => {
      Tone.getDraw().schedule(() => {
        onNoteExpected(-1, 0) // signal end
      }, Tone.now())
    }, beatOffset * beatSec)

    Tone.getTransport().start()
  }

  stopAll(): void {
    Tone.getTransport().stop()
    Tone.getTransport().cancel()
    if (this.metronomeLoop) {
      this.metronomeLoop.dispose()
      this.metronomeLoop = null
    }
    this.beatCallback = null
  }

  dispose(): void {
    this.stopAll()
    this.melodySynth.dispose()
    this.clickHigh.dispose()
    this.clickLow.dispose()
  }
}

export const audioEngine = new AudioEngineImpl()
