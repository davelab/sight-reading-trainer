import { useEffect, useRef, useState } from 'react'
import { inTauri, onMidiNote, onMidiPedal } from '../../lib/ipc'
import { chordOf, KeyTracker, tempoOf, type LiveKey } from '../../lib/live'
import {
  askClaude,
  cancelRecording,
  discardIdea,
  discardProposal,
  keepProposal,
  listenFrom,
  savePerformance,
  startRecording,
  stopRecording,
  useCompose
} from '../../stores/compose'
import { useScore } from '../../stores/score'
import { ScoreView } from '../ScoreView'
import './ComposeView.css'

const STRIP = 10

/** «Componi»: record an idea from the piano, see it written, develop it with Claude. */
export function ComposeView() {
  const c = useCompose()
  const hasScore = useScore((s) => s.events.length > 0)
  const [chord, setChord] = useState<string | null>(null)
  const [strip, setStrip] = useState<string[]>([])
  const [key, setKey] = useState<LiveKey | null>(null)
  const [tempo, setTempo] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [request, setRequest] = useState('')
  const live = useRef({
    held: new Map<number, number>(),
    sustained: new Set<number>(),
    pedal: false,
    onsets: [] as number[]
  })
  const tracker = useRef(new KeyTracker())
  const recording = c.phase === 'recording' || c.phase === 'counting'

  // Live analysis of what is played (also when not recording: try ideas freely).
  useEffect(() => {
    if (!inTauri) return
    const update = () => {
      const l = live.current
      const sounding = [...l.held.keys(), ...l.sustained]
      const found = chordOf(
        sounding,
        key ? [5, 10, 3, 8, 1, 6].includes(key.mode === 'major' ? key.tonic : (key.tonic + 3) % 12) : false
      )
      if (found) {
        setChord(found.name)
        setStrip((s) => (s[s.length - 1] === found.name ? s : [...s, found.name].slice(-STRIP)))
      }
    }
    const offNote = onMidiNote(({ pitch, on }) => {
      const l = live.current
      const now = performance.now()
      if (on) {
        l.held.set(pitch, now)
        l.sustained.delete(pitch)
        l.onsets = [...l.onsets, now].slice(-40)
        setTempo(tempoOf(l.onsets))
      } else {
        const since = l.held.get(pitch)
        l.held.delete(pitch)
        if (since !== undefined) tracker.current.add(pitch, now - since, now)
        if (l.pedal) l.sustained.add(pitch)
        setKey(tracker.current.key())
      }
      update()
    })
    const offPedal = onMidiPedal((down) => {
      const l = live.current
      l.pedal = down
      if (!down) l.sustained.clear()
    })
    return () => {
      void offNote.then((fn) => fn())
      void offPedal.then((fn) => fn())
    }
  }, [key])

  // The recording clock.
  useEffect(() => {
    if (!recording) return
    const timer = setInterval(() => setElapsed(Math.max(0, performance.now() - useCompose.getState().startedAt)), 200)
    return () => clearInterval(timer)
  }, [recording])

  const s = c.settings
  const clock = `${Math.floor(elapsed / 60000)}:${String(Math.floor(elapsed / 1000) % 60).padStart(2, '0')}`
  const shownTempo = recording && s.metronome ? s.bpm : tempo

  return (
    <div className="compose">
      <section className="compose-bar">
        {recording ? (
          <>
            <button className="rec on" onClick={() => void stopRecording()} title="Ferma e scrivi lo spartito">
              ■ Stop
            </button>
            <button onClick={() => void cancelRecording()} title="Ferma senza tenere niente, per ricominciare">
              ✕ Annulla
            </button>
          </>
        ) : (
          <button
            className="rec"
            disabled={!inTauri || c.phase === 'transcribing'}
            onClick={() => void startRecording()}
          >
            ● Registra
          </button>
        )}
        <span className="compose-clock">
          {c.phase === 'counting'
            ? 'Conto…'
            : c.phase === 'transcribing'
              ? 'Scrivo lo spartito…'
              : recording
                ? clock
                : ''}
        </span>
        <label className="compose-check">
          <input
            type="checkbox"
            checked={s.metronome}
            disabled={recording}
            onChange={(e) => c.setSettings({ metronome: e.target.checked })}
          />
          Metronomo
        </label>
        <label>
          <input
            type="number"
            min={40}
            max={200}
            step={2}
            value={s.bpm}
            disabled={recording || !s.metronome}
            onChange={(e) => c.setSettings({ bpm: Math.min(200, Math.max(40, Number(e.target.value) || 80)) })}
          />{' '}
          ♩/min
        </label>
        <select
          value={s.beatsPerMeasure}
          disabled={recording}
          onChange={(e) => c.setSettings({ beatsPerMeasure: Number(e.target.value) })}
          aria-label="Metro"
        >
          <option value={2}>2/4</option>
          <option value={3}>3/4</option>
          <option value={4}>4/4</option>
        </select>
        <label className="compose-check" title="Una battuta di clic prima di cominciare">
          <input
            type="checkbox"
            checked={s.countIn}
            disabled={recording || !s.metronome}
            onChange={(e) => c.setSettings({ countIn: e.target.checked })}
          />
          Conteggio
        </label>
        {hasScore && !recording && (
          <button onClick={() => void discardIdea()} title="Cancella lo spartito di questa idea e ricomincia da capo">
            Cancella idea
          </button>
        )}
        {c.midi && !recording && (
          <button onClick={() => void savePerformance()} title="L'esecuzione com'era, con il pedale">
            Salva MIDI…
          </button>
        )}
      </section>

      <section className="compose-live" aria-live="polite">
        <div className="live-chord">{chord ?? '—'}</div>
        <div className="live-facts">
          <span>
            <small>Tonalità</small>
            {key && key.confidence > 0.5 ? key.name : '…'}
          </span>
          <span>
            <small>Tempo</small>
            {shownTempo ? `♩ ≈ ${shownTempo}` : '…'}
          </span>
        </div>
        <div className="live-strip">
          {strip.map((name, i) => (
            <span key={`${i}-${name}`} className={i === strip.length - 1 ? 'current' : ''}>
              {name}
            </span>
          ))}
        </div>
      </section>

      {c.error && (
        <div className="error" role="alert">
          {c.error}
          <button onClick={() => useCompose.setState({ error: null })}>✕</button>
        </div>
      )}

      {hasScore ? (
        <div className="compose-work">
          <div className="compose-score">
            <ScoreView />
          </div>
          <aside className="compose-ai">
            <h3>Sviluppa con Claude</h3>
            <textarea
              rows={3}
              placeholder="Cosa vorresti? Es. «più malinconico», «una seconda parte in minore», «basso albertino»"
              value={request}
              onChange={(e) => setRequest(e.target.value)}
            />
            <div className="compose-ai-row">
              <select
                value={s.measures}
                onChange={(e) => c.setSettings({ measures: Number(e.target.value) })}
                aria-label="Quante battute"
              >
                <option value={0}>Solo idee</option>
                <option value={1}>1 battuta</option>
                <option value={2}>2 battute</option>
                <option value={4}>4 battute</option>
                <option value={8}>8 battute</option>
              </select>
              <button
                className="primary"
                disabled={c.asking || recording || !!c.preview}
                onClick={() => void askClaude(s.measures, request)}
              >
                {c.asking ? 'Claude sta pensando…' : 'Chiedi a Claude'}
              </button>
            </div>
            {c.preview && (
              <div className="compose-preview">
                <span>
                  {c.preview.added === 1 ? 'Nuova battuta' : `${c.preview.added} nuove battute`} dalla {c.preview.first}{' '}
                  (in viola).
                </span>
                <span className="compose-ai-row">
                  <button onClick={() => void listenFrom(c.preview!.first)}>▶ Ascolta</button>
                  <button className="primary" onClick={keepProposal}>
                    Tieni
                  </button>
                  <button onClick={() => void discardProposal()}>Scarta</button>
                  <button
                    onClick={async () => {
                      await discardProposal()
                      await askClaude(s.measures, request)
                    }}
                  >
                    Un'altra
                  </button>
                </span>
              </div>
            )}
            {c.advice.length > 0 && (
              <ul className="compose-advice">
                {c.advice.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            )}
            {c.problems.map((p) => (
              <small key={p} className="omr-error">
                {p}
              </small>
            ))}
            <small className="compose-note">
              Usa la chiave API di Claude (File → Chiave API): invia ad Anthropic le note delle ultime battute.
            </small>
          </aside>
        </div>
      ) : (
        <p className="compose-help">
          Premi <strong>● Registra</strong> e suona un'idea sul piano (o sulla tastiera qui sotto). Mentre suoni vedi
          l'accordo, la tonalità e il tempo; quando ti fermi diventa uno spartito, che puoi far sviluppare a Claude
          battuta per battuta. Col metronomo le battute sono esatte.
        </p>
      )}
    </div>
  )
}
