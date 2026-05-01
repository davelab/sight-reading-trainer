import { useState, useCallback, useRef, useEffect } from 'react'
import { SheetMusic } from './SheetMusic'
import { Controls } from './Controls'
import { MIDIStatus } from './MIDIStatus'
import { AccuracyDisplay } from './AccuracyDisplay'
import { useMIDI } from '../hooks/useMIDI'
import { generateMelody, midiToNoteName } from '../utils/melodyGenerator'
import { audioEngine, ensureAudioStarted } from '../utils/audioEngine'
import type {
  Clef,
  Melody,
  NoteResult,
  PracticeState,
  PracticeSession as PracticeSessionData,
  SessionNote,
} from '../types'

const COUNTDOWN_BEATS = 4
const RHYTHM_WINDOW_PCT = 0.35 // ±35% of beat duration counts as "in rhythm"

interface PracticeSessionProps {
  onSessionComplete: (session: PracticeSessionData) => void
}

export function PracticeSession({ onSessionComplete }: PracticeSessionProps) {
  const [clef, setClef] = useState<Clef>('treble')
  const [bpm, setBpm] = useState(80)
  const [numMeasures, setNumMeasures] = useState(2)
  const [melody, setMelody] = useState<Melody>(() => generateMelody('treble', 2))
  const [practiceState, setPracticeState] = useState<PracticeState>('idle')
  const [activeNoteIndex, setActiveNoteIndex] = useState(-1)
  const [noteResults, setNoteResults] = useState<NoteResult[]>([])
  const [sessionNotes, setSessionNotes] = useState<SessionNote[]>([])
  const [countdownBeat, setCountdownBeat] = useState(0)
  const [completedSession, setCompletedSession] = useState<PracticeSessionData | null>(null)

  // Refs for mutable state accessed inside audio callbacks
  const activeNoteIndexRef = useRef(-1)
  const expectedTimeMsRef = useRef(0)
  const noteResultsRef = useRef<NoteResult[]>([])
  const sessionNotesRef = useRef<SessionNote[]>([])
  const melodyRef = useRef<Melody>(melody)
  melodyRef.current = melody
  const bpmRef = useRef(bpm)
  bpmRef.current = bpm

  const handleNewMelody = useCallback(() => {
    const m = generateMelody(clef, numMeasures)
    setMelody(m)
    setActiveNoteIndex(-1)
    setNoteResults([])
    setSessionNotes([])
    setCompletedSession(null)
    setPracticeState('idle')
    noteResultsRef.current = []
    sessionNotesRef.current = []
    activeNoteIndexRef.current = -1
    audioEngine.stopAll()
  }, [clef, numMeasures])

  const handleClefChange = useCallback((c: Clef) => {
    setClef(c)
    const m = generateMelody(c, numMeasures)
    setMelody(m)
    setActiveNoteIndex(-1)
    setNoteResults([])
    setSessionNotes([])
    setCompletedSession(null)
    setPracticeState('idle')
    noteResultsRef.current = []
    sessionNotesRef.current = []
    audioEngine.stopAll()
  }, [numMeasures])

  const handleMeasuresChange = useCallback((n: number) => {
    setNumMeasures(n)
    const m = generateMelody(clef, n)
    setMelody(m)
    setActiveNoteIndex(-1)
    setNoteResults([])
    setSessionNotes([])
    setCompletedSession(null)
    setPracticeState('idle')
    noteResultsRef.current = []
    sessionNotesRef.current = []
    audioEngine.stopAll()
  }, [clef])

  const handlePlayReference = useCallback(async () => {
    await ensureAudioStarted()
    setPracticeState('listening')
    audioEngine.stopAll()
    await audioEngine.playReference(melody.notes, bpm)
    // Return to idle after playback duration
    const totalBeats = melody.notes.reduce((s, n) => s + n.durationBeats, 0)
    const durationMs = (totalBeats / bpm) * 60 * 1000 + 500
    setTimeout(() => setPracticeState('idle'), durationMs)
  }, [melody, bpm])

  const handleNoteExpected = useCallback((noteIndex: number, expectedTimeMs: number) => {
    if (noteIndex === -1) {
      // End of practice — finalize any unplayed notes
      const currentNotes = melodyRef.current.notes
      const currentResults = [...noteResultsRef.current]
      const currentSessionNotes = [...sessionNotesRef.current]

      for (let i = 0; i < currentNotes.length; i++) {
        if (currentResults[i] == null) {
          currentResults[i] = 'missed'
          currentSessionNotes.push({
            noteId: currentNotes[i].id,
            expected: currentNotes[i].pitch,
            played: null,
            pitchCorrect: false,
            timingOffsetMs: 9999,
            rhythmCorrect: false,
          })
        }
      }

      noteResultsRef.current = currentResults
      sessionNotesRef.current = currentSessionNotes
      setNoteResults([...currentResults])
      setSessionNotes([...currentSessionNotes])
      setActiveNoteIndex(-1)
      activeNoteIndexRef.current = -1
      setPracticeState('finished')
      audioEngine.stopAll()

      // Build and emit session
      const total = currentNotes.length
      const correctPitch = currentSessionNotes.filter(n => n.pitchCorrect).length
      const correctRhythm = currentSessionNotes.filter(n => n.rhythmCorrect).length
      const session: PracticeSessionData = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        date: new Date().toISOString(),
        bpm: bpmRef.current,
        clef: melodyRef.current.clef,
        numMeasures: melodyRef.current.numMeasures,
        totalNotes: total,
        correctPitch,
        correctRhythm,
        pitchAccuracy: total > 0 ? Math.round((correctPitch / total) * 100) : 0,
        rhythmAccuracy: total > 0 ? Math.round((correctRhythm / total) * 100) : 0,
        notes: currentSessionNotes,
      }
      setCompletedSession(session)
      onSessionComplete(session)
      return
    }

    activeNoteIndexRef.current = noteIndex
    expectedTimeMsRef.current = expectedTimeMs
    setActiveNoteIndex(noteIndex)
  }, [onSessionComplete])

  const handleStartPractice = useCallback(async () => {
    await ensureAudioStarted()
    audioEngine.stopAll()

    // Reset state
    const emptyResults: NoteResult[] = melody.notes.map(() => null)
    noteResultsRef.current = emptyResults
    sessionNotesRef.current = []
    activeNoteIndexRef.current = -1
    setNoteResults(emptyResults)
    setSessionNotes([])
    setActiveNoteIndex(-1)
    setCompletedSession(null)
    setPracticeState('countdown')

    audioEngine.startPracticeWithMetronome(
      bpm,
      (beat) => {
        setCountdownBeat(beat)
      },
      handleNoteExpected,
      melody.notes,
      COUNTDOWN_BEATS
    )

    // Transition from countdown to practicing after COUNTDOWN_BEATS
    const countdownMs = (COUNTDOWN_BEATS / bpm) * 60 * 1000
    setTimeout(() => {
      setPracticeState('practicing')
    }, countdownMs)
  }, [melody, bpm, handleNoteExpected])

  const handleStopPractice = useCallback(() => {
    audioEngine.stopAll()
    setActiveNoteIndex(-1)
    activeNoteIndexRef.current = -1
    setPracticeState('idle')
    setNoteResults([])
    setSessionNotes([])
    noteResultsRef.current = []
    sessionNotesRef.current = []
  }, [])

  const onMidiNoteOn = useCallback(
    (event: { midi: number; timestamp: number }) => {
      if (practiceState !== 'practicing') return

      const noteIndex = activeNoteIndexRef.current
      if (noteIndex < 0 || noteIndex >= melodyRef.current.notes.length) return
      if (noteResultsRef.current[noteIndex] != null) return // already evaluated

      const expectedNote = melodyRef.current.notes[noteIndex]
      const pitchCorrect = event.midi === expectedNote.midi
      const timingOffsetMs = Math.abs(performance.now() - expectedTimeMsRef.current)
      const beatDurationMs = (60 / bpmRef.current) * 1000
      const rhythmCorrect = timingOffsetMs <= beatDurationMs * RHYTHM_WINDOW_PCT

      const result: NoteResult = pitchCorrect ? 'correct' : 'incorrect'
      noteResultsRef.current = [
        ...noteResultsRef.current.slice(0, noteIndex),
        result,
        ...noteResultsRef.current.slice(noteIndex + 1),
      ]

      sessionNotesRef.current = [
        ...sessionNotesRef.current,
        {
          noteId: expectedNote.id,
          expected: expectedNote.pitch,
          played: midiToNoteName(event.midi),
          pitchCorrect,
          timingOffsetMs,
          rhythmCorrect,
        },
      ]

      setNoteResults([...noteResultsRef.current])
    },
    [practiceState]
  )

  const midiState = useMIDI(onMidiNoteOn)

  // Cleanup on unmount
  useEffect(() => {
    return () => { audioEngine.stopAll() }
  }, [])

  const correctPitch = sessionNotes.filter(n => n.pitchCorrect).length
  const correctRhythm = sessionNotes.filter(n => n.rhythmCorrect).length

  return (
    <div className="practice-session">
      <div className="sheet-music-wrapper">
        {practiceState === 'countdown' && (
          <div className="countdown-overlay">
            <span className="countdown-text">
              {countdownBeat === 0 ? '1' : countdownBeat === 1 ? '2' : countdownBeat === 2 ? '3' : '4'}
            </span>
          </div>
        )}
        <SheetMusic
          notes={melody.notes}
          clef={melody.clef}
          numMeasures={melody.numMeasures}
          activeNoteIndex={activeNoteIndex}
          noteResults={noteResults}
        />
      </div>

      <div className="practice-footer">
        <MIDIStatus midiState={midiState} />

        {practiceState === 'finished' && completedSession && (
          <div className="session-result">
            <span className="result-label">Session complete</span>
            <AccuracyDisplay
              totalNotes={melody.notes.length}
              correctPitch={correctPitch}
              correctRhythm={correctRhythm}
            />
          </div>
        )}

        {practiceState === 'practicing' && sessionNotes.length > 0 && (
          <AccuracyDisplay
            totalNotes={sessionNotes.length}
            correctPitch={correctPitch}
            correctRhythm={correctRhythm}
          />
        )}

        <Controls
          clef={clef}
          bpm={bpm}
          numMeasures={numMeasures}
          practiceState={practiceState}
          midiConnected={midiState.isConnected}
          onClefChange={handleClefChange}
          onBpmChange={setBpm}
          onMeasuresChange={handleMeasuresChange}
          onNewMelody={handleNewMelody}
          onPlayReference={handlePlayReference}
          onStartPractice={handleStartPractice}
          onStopPractice={handleStopPractice}
        />
      </div>
    </div>
  )
}
