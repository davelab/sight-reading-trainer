import { useCallback, useEffect, useRef, useState } from 'react'
import {
  answer,
  nextNote,
  nextRhythm,
  nextShape,
  questionXml,
  RHYTHM_LEVELS,
  rhythmClicks,
  rhythmEvents,
  rhythmXml,
  sessionStats,
  type Attempt,
  type Clef,
  type NoteQuestion,
  type RhythmNote,
  type ShapeKind,
  type Zone
} from '../../lib/drills'
import { inTauri, ipc, onMidiNote, onTimedNotes, onTimedSummary, type NoteJudgement } from '../../lib/ipc'
import { restorePlayback } from '../../lib/loadScore'
import { useMidi } from '../../stores/midi'
import { TOLERANCE_MS, useView } from '../../stores/view'
import { Snippet } from './Snippet'
import { SolfegeDrill } from './SolfegeDrill'
import './DrillView.css'

type Tab = 'notes' | 'shapes' | 'rhythm' | 'solfege'

interface DrillSettings {
  tab: Tab
  clef: Clef
  zone: Zone
  accidentals: boolean
  anyOctave: boolean
  minutes: number
  shapeClef: 'treble' | 'bass'
  shapeKind: ShapeKind
  shapeAccidentals: boolean
  level: number
  bpm: number
}

const DEFAULTS: DrillSettings = {
  tab: 'notes',
  clef: 'treble',
  zone: 'staff',
  accidentals: false,
  anyOctave: false,
  minutes: 1,
  shapeClef: 'treble',
  shapeKind: 'intervals',
  shapeAccidentals: false,
  level: 1,
  bpm: 70
}
const SETTINGS_KEY = 'drill-settings'
const RECORDS_KEY = 'drill-records'

function loadJson<T>(key: string, fallback: T): T {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
    return saved && typeof saved === 'object' ? { ...fallback, ...saved } : fallback
  } catch {
    return fallback
  }
}

function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage unavailable: lasts for this session only
  }
}

/** Short daily drills: note reading, intervals and chords, rhythm. */
export function DrillView() {
  const [settings, setSettings] = useState<DrillSettings>(() => loadJson(SETTINGS_KEY, DEFAULTS))
  const set = (patch: Partial<DrillSettings>) =>
    setSettings((s) => {
      const next = { ...s, ...patch }
      saveJson(SETTINGS_KEY, next)
      return next
    })

  // The keys answer the drill, not follow or "A tempo" mode.
  useEffect(() => {
    if (!inTauri) return
    if (useMidi.getState().following) void ipc.setFollowMode(false)
    if (useMidi.getState().timed) void ipc.stopTimedMode()
  }, [])

  return (
    <div className="drills">
      <div className="drill-tabs segmented" role="tablist">
        {(
          [
            ['notes', 'Lettura note'],
            ['shapes', 'Intervalli e accordi'],
            ['rhythm', 'Ritmo'],
            ['solfege', 'Solfeggio']
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={settings.tab === value}
            className={settings.tab === value ? 'selected' : ''}
            onClick={() => set({ tab: value })}
          >
            {label}
          </button>
        ))}
      </div>
      {!inTauri && (
        <p className="drill-note">Gli esercizi usano il piano MIDI o la tastiera a schermo: apri l'app desktop.</p>
      )}
      {settings.tab === 'solfege' ? (
        <SolfegeDrill />
      ) : settings.tab === 'rhythm' ? (
        <RhythmDrill settings={settings} set={set} />
      ) : (
        <ReadingDrill key={settings.tab} settings={settings} set={set} shapes={settings.tab === 'shapes'} />
      )}
    </div>
  )
}

// --- Notes, intervals and chords --------------------------------------------------

function ReadingDrill({
  settings,
  set,
  shapes
}: {
  settings: DrillSettings
  set: (patch: Partial<DrillSettings>) => void
  shapes: boolean
}) {
  const [running, setRunning] = useState(false)
  const [question, setQuestion] = useState<NoteQuestion | null>(null)
  const [feedback, setFeedback] = useState<{ kind: 'right' | 'wrong'; text: string } | null>(null)
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [remaining, setRemaining] = useState(0)
  const [finished, setFinished] = useState<{ elapsed: number; record: boolean } | null>(null)
  const held = useRef(new Set<number>())
  const attemptsRef = useRef<Attempt[]>([])
  const timing = useRef({ session: 0, question: 0, errors: 0, ends: 0 })
  const current = useRef<NoteQuestion | null>(null)
  const recordKey = shapes
    ? `shapes:${settings.shapeClef}:${settings.shapeKind}:${settings.shapeAccidentals}`
    : `notes:${settings.clef}:${settings.zone}:${settings.accidentals}:${settings.anyOctave}`
  const records = loadJson<Record<string, number>>(RECORDS_KEY, {})

  const ask = useCallback(
    (previous: NoteQuestion | null) => {
      const q = shapes
        ? nextShape(
            { clef: settings.shapeClef, kind: settings.shapeKind, accidentals: settings.shapeAccidentals },
            previous
          )
        : nextNote({ clef: settings.clef, zone: settings.zone, accidentals: settings.accidentals }, previous)
      current.current = q
      timing.current.question = performance.now()
      timing.current.errors = 0
      setQuestion(q)
    },
    [shapes, settings]
  )

  const stop = useCallback(
    (completed: boolean) => {
      setRunning(false)
      current.current = null
      if (!completed) return
      const elapsed = performance.now() - timing.current.session
      const stats = sessionStats(attemptsRef.current, elapsed)
      const best = loadJson<Record<string, number>>(RECORDS_KEY, {})
      const record = stats.done > 0 && stats.perMinute > (best[recordKey] ?? 0)
      if (record) saveJson(RECORDS_KEY, { ...best, [recordKey]: stats.perMinute })
      setFinished({ elapsed, record })
    },
    [recordKey]
  )

  const start = () => {
    setAttempts([])
    attemptsRef.current = []
    setFinished(null)
    setFeedback(null)
    held.current.clear()
    const now = performance.now()
    timing.current = { session: now, question: now, errors: 0, ends: now + settings.minutes * 60000 }
    setRunning(true)
    ask(null)
  }

  // Countdown, and the end of the session.
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => {
      const left = timing.current.ends - performance.now()
      setRemaining(Math.max(0, left))
      if (left <= 0) stop(true)
    }, 200)
    return () => clearInterval(timer)
  }, [running, stop])

  // Keys from the MIDI piano or the on-screen keyboard.
  useEffect(() => {
    if (!inTauri) return
    const off = onMidiNote(({ pitch, on }) => {
      if (on) held.current.add(pitch)
      else held.current.delete(pitch)
      const q = current.current
      if (!on || !q) return
      const result = answer([...held.current], q, !shapes && settings.anyOctave)
      if (result === 'wrong') {
        timing.current.errors += 1
        setFeedback({ kind: 'wrong', text: 'No: riprova' })
      } else if (result === 'right') {
        const ms = performance.now() - timing.current.question
        attemptsRef.current = [...attemptsRef.current, { label: q.label, ms, clean: timing.current.errors === 0 }]
        setAttempts(attemptsRef.current)
        setFeedback({ kind: 'right', text: q.label })
        current.current = null
        // A moment to see the answer, then the next one (keys released or not).
        setTimeout(() => {
          if (performance.now() < timing.current.ends) ask(q)
        }, 350)
      }
    })
    return () => void off.then((fn) => fn())
  }, [ask, shapes, settings.anyOctave])

  const stats = sessionStats(attempts, finished?.elapsed ?? performance.now() - timing.current.session)
  const best = records[recordKey]

  return (
    <div className="drill">
      <div className="drill-options">
        {shapes ? (
          <>
            <label>
              Chiave
              <select
                value={settings.shapeClef}
                disabled={running}
                onChange={(e) => set({ shapeClef: e.target.value as 'treble' | 'bass' })}
              >
                <option value="treble">Violino</option>
                <option value="bass">Basso</option>
              </select>
            </label>
            <label>
              Cosa
              <select
                value={settings.shapeKind}
                disabled={running}
                onChange={(e) => set({ shapeKind: e.target.value as ShapeKind })}
              >
                <option value="intervals">Intervalli</option>
                <option value="triads">Triadi e rivolti</option>
                <option value="both">Entrambi</option>
              </select>
            </label>
            <label className="drill-check">
              <input
                type="checkbox"
                checked={settings.shapeAccidentals}
                disabled={running}
                onChange={(e) => set({ shapeAccidentals: e.target.checked })}
              />
              Con alterazioni
            </label>
          </>
        ) : (
          <>
            <label>
              Chiave
              <select value={settings.clef} disabled={running} onChange={(e) => set({ clef: e.target.value as Clef })}>
                <option value="treble">Violino</option>
                <option value="bass">Basso</option>
                <option value="both">Entrambe</option>
              </select>
            </label>
            <label>
              Zona
              <select value={settings.zone} disabled={running} onChange={(e) => set({ zone: e.target.value as Zone })}>
                <option value="staff">Dentro il pentagramma</option>
                <option value="ledger">Solo tagli addizionali</option>
                <option value="all">Tutto</option>
              </select>
            </label>
            <label className="drill-check">
              <input
                type="checkbox"
                checked={settings.accidentals}
                disabled={running}
                onChange={(e) => set({ accidentals: e.target.checked })}
              />
              Con alterazioni
            </label>
            <label className="drill-check" title="Vale il nome della nota in qualsiasi ottava">
              <input
                type="checkbox"
                checked={settings.anyOctave}
                disabled={running}
                onChange={(e) => set({ anyOctave: e.target.checked })}
              />
              Ottava libera
            </label>
          </>
        )}
        <label>
          Durata
          <select
            value={settings.minutes}
            disabled={running}
            onChange={(e) => set({ minutes: Number(e.target.value) })}
          >
            <option value={1}>1 minuto</option>
            <option value={2}>2 minuti</option>
            <option value={5}>5 minuti</option>
          </select>
        </label>
        {running ? (
          <button onClick={() => stop(true)}>Fine</button>
        ) : (
          <button className="primary" disabled={!inTauri} onClick={start}>
            {finished ? 'Ancora' : 'Inizia'}
          </button>
        )}
      </div>

      {running && question && (
        <div className="drill-stage">
          <Snippet xml={questionXml(question)} scale={shapes ? 120 : 130} />
          <div className={`drill-feedback ${feedback?.kind ?? ''}`}>
            {feedback?.text ?? (shapes ? 'Suona tutte le note insieme' : 'Suona la nota')}
          </div>
          <div className="drill-live">
            {Math.ceil(remaining / 1000)} s · {attempts.length} {shapes ? 'riconosciuti' : 'note'}
            {attempts.length > 0 && ` · media ${(stats.meanMs / 1000).toFixed(1)} s`}
          </div>
        </div>
      )}

      {!running && finished && (
        <div className="drill-result">
          <strong>
            {Math.round(stats.perMinute)} {shapes ? 'al minuto' : 'note al minuto'}
            {finished.record ? ' · nuovo record!' : best ? ` · record ${Math.round(best)}` : ''}
          </strong>
          <span>
            {stats.done} giuste, {Math.round(stats.firstTry * 100)}% al primo colpo, in media{' '}
            {(stats.meanMs / 1000).toFixed(1)} s ciascuna.
          </span>
          {stats.slowest.length > 0 && (
            <span>
              Le più lente: {stats.slowest.map((a) => `${a.label} (${(a.ms / 1000).toFixed(1)} s)`).join(', ')}.
            </span>
          )}
        </div>
      )}

      {!running && !finished && (
        <p className="drill-help">
          {shapes
            ? 'Compare un intervallo o un accordo: suona tutte le sue note insieme. Così si impara a riconoscere la forma invece di leggere nota per nota.'
            : 'Compare una nota: suonala appena la riconosci. Conta la velocità: l’errore non si penalizza, ma la nota resta finché non trovi quella giusta.'}
          {best ? ` Record con queste impostazioni: ${Math.round(best)} al minuto.` : ''}
        </p>
      )}
    </div>
  )
}

// --- Rhythm ---------------------------------------------------------------------

const VERDICT_TEXT = { correct: 'a tempo', early: 'in anticipo', late: 'in ritardo', missed: 'mancata' } as const

function RhythmDrill({ settings, set }: { settings: DrillSettings; set: (patch: Partial<DrillSettings>) => void }) {
  const [rhythm, setRhythm] = useState<RhythmNote[]>(() => nextRhythm(settings.level))
  const [verdicts, setVerdicts] = useState<Record<number, NoteJudgement>>({})
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const events = rhythmEvents(rhythm, settings.bpm)

  // Colour the notes as they are judged (rendered notes in order = tapped notes).
  useEffect(() => {
    const notes = [...(stageRef.current?.querySelectorAll('g.note') ?? [])].filter((n) => !n.closest('g.rest'))
    notes.forEach((el, i) => {
      el.classList.remove('correct', 'early', 'late', 'missed')
      const v = events[i] ? verdicts[Math.round(events[i].onsetMs)] : undefined
      if (v) el.classList.add(v.verdict)
    })
  })

  useEffect(() => {
    if (!inTauri) return
    const offNotes = onTimedNotes((list) =>
      setVerdicts((v) => ({ ...v, ...Object.fromEntries(list.map((j) => [Math.round(j.onsetMs), j])) }))
    )
    const offSummary = onTimedSummary((s) => {
      setRunning(false)
      const hit = s.correct + s.early + s.late
      const total = s.expected + s.wrong
      setResult(
        `${s.correct} a tempo, ${s.early} in anticipo, ${s.late} in ritardo, ${s.missed} mancate` +
          (s.wrong ? `, ${s.wrong} in più` : '') +
          ` — ${total ? Math.round((s.correct / total) * 100) : 0}% preciso.` +
          (hit && Math.abs(s.meanOffsetMs) >= 20
            ? ` In media ${Math.abs(Math.round(s.meanOffsetMs))} ms ${s.meanOffsetMs > 0 ? 'in ritardo' : 'in anticipo'}.`
            : '')
      )
      useMidi.getState().set({ timedSummary: null })
      void restorePlayback()
    })
    return () => {
      void offNotes.then((fn) => fn())
      void offSummary.then((fn) => fn())
      // Leaving the drill mid-run: give the transport back to the score.
      if (useMidi.getState().timed) void ipc.stopTimedMode().then(() => restorePlayback())
    }
  }, [])

  const start = async () => {
    setVerdicts({})
    setResult(null)
    setRunning(true)
    const beatMs = 60000 / settings.bpm
    await ipc.playbackLoad(events)
    await Promise.all([ipc.setTempo(100), ipc.setHands('both'), ipc.setLoop(null)])
    await ipc.setClicks(rhythmClicks(settings.bpm))
    await ipc.setMetronome(true)
    await ipc.seek(0)
    await ipc.startTimedMode(TOLERANCE_MS[useView.getState().tolerance], { beats: 4, beatMs }, true)
  }

  const newRhythm = (level = settings.level) => {
    setRhythm(nextRhythm(level))
    setVerdicts({})
    setResult(null)
  }

  return (
    <div className="drill">
      <div className="drill-options">
        <label>
          Livello
          <select
            value={settings.level}
            disabled={running}
            onChange={(e) => {
              set({ level: Number(e.target.value) })
              newRhythm(Number(e.target.value))
            }}
          >
            {RHYTHM_LEVELS.map((name, i) => (
              <option key={name} value={i}>
                {i + 1}. {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tempo
          <input
            type="number"
            min={40}
            max={160}
            step={5}
            value={settings.bpm}
            disabled={running}
            onChange={(e) => set({ bpm: Math.min(160, Math.max(40, Number(e.target.value) || 70)) })}
          />
          ♩/min
        </label>
        <button disabled={running} onClick={() => newRhythm()}>
          Nuovo ritmo
        </button>
        {running ? (
          <button onClick={() => void ipc.stopTimedMode()}>Ferma</button>
        ) : (
          <button className="primary" disabled={!inTauri} onClick={() => void start()}>
            {result ? 'Riprova' : 'Inizia'}
          </button>
        )}
      </div>
      <div className="drill-stage" ref={stageRef}>
        <Snippet xml={rhythmXml(rhythm)} className="rhythm" scale={90} />
        <div className="drill-feedback">
          {running
            ? 'Una battuta di conteggio, poi batti il ritmo su un tasto qualsiasi'
            : (result ?? 'Leggi il ritmo, poi premi Inizia')}
        </div>
        <div className="drill-legend">
          {Object.entries(VERDICT_TEXT).map(([k, label]) => (
            <span key={k} className={`legend-${k}`}>
              ● {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
