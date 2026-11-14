import { useEffect, useRef, useState } from 'react'
import { inTauri, ipc, onTimedNotes, onTimedSummary, type NoteJudgement } from '../../lib/ipc'
import { restorePlayback } from '../../lib/loadScore'
import {
  nextPhrase,
  phraseClicks,
  phraseEvents,
  phraseXml,
  SOLFEGE_LEVELS,
  type LyricMode,
  type Phrase,
  type PickupMode
} from '../../lib/solfege'
import { useMidi } from '../../stores/midi'
import { useTransport } from '../../stores/transport'
import { TOLERANCE_MS, useView } from '../../stores/view'
import { Snippet } from './Snippet'

interface SolfegeSettings {
  level: number
  /** Judge the notes too, or only the rhythm (any key). */
  mode: 'notes' | 'rhythm'
  bpm: number
  lyrics: LyricMode
  pickup: PickupMode
}

const KEY = 'solfege-settings'
const DEFAULTS: SolfegeSettings = { level: 0, mode: 'notes', bpm: 72, lyrics: 'syllables', pickup: 'sometimes' }

function load(): SolfegeSettings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}) }
  } catch {
    return { ...DEFAULTS }
  }
}

const VERDICT_TEXT = { correct: 'a tempo', early: 'in anticipo', late: 'in ritardo', missed: 'mancata' } as const

/**
 * Solfeggio: a melodic phrase built from known rhythmic cells, to read in time.
 * «Ascolta» plays it with the metronome; «Suona» lets you read it at the piano,
 * judged note by note (pitch and rhythm, or rhythm only).
 */
export function SolfegeDrill() {
  const [s, setS] = useState<SolfegeSettings>(load)
  const [phrase, setPhrase] = useState<Phrase>(() => nextPhrase(load().level, Math.random, load().pickup))
  const [verdicts, setVerdicts] = useState<Record<number, NoteJudgement>>({})
  const [state, setState] = useState<'idle' | 'listening' | 'playing'>('idle')
  const [result, setResult] = useState<string | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  const listening = useRef(false)
  const events = phraseEvents(phrase, s.bpm)
  const level = SOLFEGE_LEVELS[s.level]

  const set = (patch: Partial<SolfegeSettings>) =>
    setS((x) => {
      const next = { ...x, ...patch }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        // storage unavailable
      }
      return next
    })

  // Colour the notes as they are judged (rendered notes in order = sounding notes).
  useEffect(() => {
    const notes = [...(stage.current?.querySelectorAll('g.note') ?? [])]
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
    const offSummary = onTimedSummary((sum) => {
      setState('idle')
      const total = sum.expected + sum.wrong
      setResult(
        `${sum.correct} a tempo, ${sum.early + sum.late} fuori tempo, ${sum.wrong} sbagliate, ${sum.missed} mancate — ` +
          `${total ? Math.round(((sum.correct + 0.5 * (sum.early + sum.late)) / total) * 100) : 0}% su ${sum.expected} note.`
      )
      useMidi.getState().set({ timedSummary: null })
      void restorePlayback()
    })
    // «Ascolta» ends when the transport stops.
    const offTransport = useTransport.subscribe((t, prev) => {
      if (prev.playing && !t.playing && listening.current) {
        listening.current = false
        setState('idle')
        void restorePlayback()
      }
    })
    return () => {
      void offNotes.then((fn) => fn())
      void offSummary.then((fn) => fn())
      offTransport()
      if (useMidi.getState().timed) void ipc.stopTimedMode().then(() => restorePlayback())
      else if (listening.current) void ipc.pause().then(() => restorePlayback())
    }
  }, [])

  const load_ = async () => {
    await ipc.playbackLoad(events)
    await Promise.all([ipc.setTempo(100), ipc.setHands('both'), ipc.setLoop(null)])
    await ipc.setClicks(phraseClicks(phrase, s.bpm))
    await ipc.setMetronome(true)
    await ipc.seek(0)
  }

  const listen = async () => {
    setVerdicts({})
    setResult(null)
    setState('listening')
    await load_()
    listening.current = true
    await ipc.play()
  }

  const play = async () => {
    setVerdicts({})
    setResult(null)
    setState('playing')
    await load_()
    await ipc.startTimedMode(
      TOLERANCE_MS[useView.getState().tolerance],
      { beats: phrase.meter, beatMs: 60000 / s.bpm },
      s.mode === 'rhythm'
    )
  }

  const stop = async () => {
    if (state === 'playing') await ipc.stopTimedMode()
    else if (state === 'listening') await ipc.pause()
  }

  const fresh = (levelIndex = s.level, pickup = s.pickup) => {
    setPhrase(nextPhrase(levelIndex, Math.random, pickup))
    setVerdicts({})
    setResult(null)
  }

  const busy = state !== 'idle'
  return (
    <div className="drill">
      <div className="drill-options">
        <label>
          Livello
          <select
            value={s.level}
            disabled={busy}
            title={level.hint}
            onChange={(e) => {
              set({ level: Number(e.target.value) })
              fresh(Number(e.target.value))
            }}
          >
            {SOLFEGE_LEVELS.map((l, i) => (
              <option key={l.name} value={i} title={l.hint}>
                {i + 1}. {l.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Suoni
          <select
            value={s.mode}
            disabled={busy}
            onChange={(e) => set({ mode: e.target.value as SolfegeSettings['mode'] })}
          >
            <option value="notes">Note e ritmo</option>
            <option value="rhythm">Solo ritmo (un tasto qualsiasi)</option>
          </select>
        </label>
        <label title="La frase comincia prima della prima stanghetta (di solito Sol → Do); l'ultima battuta è accorciata di altrettanto">
          Levare
          <select
            value={s.pickup}
            disabled={busy}
            onChange={(e) => {
              set({ pickup: e.target.value as PickupMode })
              fresh(s.level, e.target.value as PickupMode)
            }}
          >
            <option value="never">Mai</option>
            <option value="sometimes">A volte</option>
            <option value="always">Sempre</option>
          </select>
        </label>
        <label>
          Sotto le note
          <select value={s.lyrics} onChange={(e) => set({ lyrics: e.target.value as LyricMode })}>
            <option value="syllables">Sillabe ritmiche</option>
            <option value="names">Nomi delle note</option>
            <option value="none">Niente</option>
          </select>
        </label>
        <label>
          Tempo
          <input
            type="number"
            min={40}
            max={160}
            step={4}
            value={s.bpm}
            disabled={busy}
            onChange={(e) => set({ bpm: Math.min(160, Math.max(40, Number(e.target.value) || 72)) })}
          />
          ♩/min
        </label>
      </div>
      <div className="drill-options">
        <button disabled={busy} onClick={() => fresh()}>
          Nuova frase
        </button>
        <button disabled={busy || !inTauri} onClick={() => void listen()} title="La frase suonata, col metronomo">
          ▶ Ascolta
        </button>
        {busy ? (
          <button onClick={() => void stop()}>■ Ferma</button>
        ) : (
          <button className="primary" disabled={!inTauri} onClick={() => void play()}>
            {result ? 'Riprova' : 'Suona'}
          </button>
        )}
        <span className="drill-live">
          {phrase.key.name} · {phrase.meter}/4
          {phrase.pickup
            ? ` · in levare (${phrase.pickup === 1 ? '1 movimento' : `${phrase.pickup} movimenti`})`
            : ''}{' '}
          · {level.hint}
        </span>
      </div>
      <div className="drill-stage" ref={stage}>
        <Snippet xml={phraseXml(phrase, s.lyrics)} className="rhythm" scale={80} />
        <div className="drill-feedback">
          {state === 'playing'
            ? 'Una battuta di conteggio, poi leggi la frase a tempo senza fermarti'
            : state === 'listening'
              ? 'Ascolta…'
              : (result ?? 'Prima leggila con gli occhi: tonalità, metro, cellule ritmiche. Poi suonala.')}
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
