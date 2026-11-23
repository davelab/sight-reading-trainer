import { useEffect, useRef, useState } from 'react'
import {
  CHORD_GROUPS,
  CHORDS,
  earEvents,
  INTERVAL_SETS,
  INTERVALS,
  NO_STATS,
  nextChord,
  nextInterval,
  record,
  ROOT_NAMES,
  topConfusions,
  type ChordGroup,
  type EarMode,
  type EarQuestion,
  type EarStats,
  type IntervalDirection
} from '../../lib/ear'
import { inTauri, ipc } from '../../lib/ipc'
import { restorePlayback } from '../../lib/loadScore'
import './EarDrill.css'

interface EarSettings {
  mode: EarMode
  intervals: string[]
  direction: IntervalDirection
  groups: ChordGroup[]
  inversions: boolean
  arpeggiate: boolean
}

const KEY = 'ear-settings'
const DEFAULTS: EarSettings = {
  mode: 'intervals',
  intervals: INTERVAL_SETS[1].ids,
  direction: 'up',
  groups: ['triads'],
  inversions: false,
  arpeggiate: false
}

function load(): EarSettings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}) }
  } catch {
    return { ...DEFAULTS }
  }
}

/** Play a question (or the answer chosen) through the Rust synth. */
async function sound(q: EarQuestion): Promise<void> {
  if (!inTauri) return
  await ipc.pause()
  await ipc.playbackLoad(earEvents(q))
  await Promise.all([ipc.setTempo(100), ipc.setHands('both'), ipc.setLoop(null), ipc.setClicks([])])
  await ipc.setMetronome(false)
  await ipc.seek(0)
  await ipc.play()
}

/** The question as it would sound if the answer given were right (to compare). */
function asAnswered(q: EarQuestion, given: string): EarQuestion {
  if (q.mode === 'intervals') {
    const def = INTERVALS.find((i) => i.id === given)
    if (!def) return q
    const first = q.sound[0][0]
    const down = q.sound.length === 2 && q.sound[1][0] < first
    const other = down ? first - def.semitones : first + def.semitones
    return { ...q, sound: q.sound.length === 1 ? [[first, first + def.semitones]] : [[first], [other]] }
  }
  const [rootPart, chordId] = q.mode === 'exact' ? given.split(':') : ['', given]
  const chord = CHORDS.find((c) => c.id === chordId)
  if (!chord) return q
  const lowest = Math.min(...q.sound.flat())
  const root = q.mode === 'exact' ? 41 + ((((Number(rootPart) - 41) % 12) + 12) % 12) : lowest
  const notes = chord.intervals.map((i) => root + i)
  return { ...q, sound: [notes] }
}

/** Ear training: name what you hear (intervals, chord colours, exact chords). */
export function EarDrill() {
  const [s, setS] = useState<EarSettings>(load)
  const [question, setQuestion] = useState<EarQuestion | null>(null)
  const [given, setGiven] = useState<string | null>(null)
  const [root, setRoot] = useState<number | null>(null)
  const [stats, setStats] = useState<EarStats>(NO_STATS)
  const touched = useRef(false)

  const set = (patch: Partial<EarSettings>) =>
    setS((x) => {
      const next = { ...x, ...patch }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        // storage unavailable
      }
      return next
    })

  // Leaving the tab: the score gets its playback back.
  useEffect(
    () => () => {
      if (touched.current) void ipc.pause().then(() => restorePlayback())
    },
    []
  )

  const ask = (mode = s.mode) => {
    const q =
      mode === 'intervals'
        ? nextInterval(s.intervals, s.direction, question)
        : nextChord(mode, { groups: s.groups, inversions: s.inversions, arpeggiate: s.arpeggiate }, question)
    setQuestion(q)
    setGiven(null)
    setRoot(null)
    touched.current = true
    void sound(q)
  }

  const answer = (id: string) => {
    if (!question || given) return
    setGiven(id)
    setStats((st) => record(st, id, question.answer))
  }

  const switchMode = (mode: EarMode) => {
    set({ mode })
    setQuestion(null)
    setGiven(null)
    setStats(NO_STATS)
  }

  const right = given !== null && question !== null && given === question.answer
  const confusions = topConfusions(stats, s.mode)

  // Answer buttons for the mode.
  // Same fallbacks as the question generators when nothing is selected.
  const picked = INTERVALS.filter((i) => s.intervals.includes(i.id))
  const intervalChoices = picked.length ? picked : INTERVALS.filter((i) => i.id === 'P5')
  const groups = s.groups.length ? s.groups : ['triads']
  const chordChoices = CHORDS.filter((c) => groups.includes(c.group))
  const buttonClass = (id: string) =>
    !given || !question ? '' : id === question.answer ? 'ear-right' : id === given ? 'ear-wrong' : ''

  return (
    <div className="drill">
      <div className="drill-tabs segmented ear-modes">
        {(
          [
            ['intervals', 'Intervalli'],
            ['quality', 'Colore degli accordi'],
            ['exact', 'Accordo esatto']
          ] as const
        ).map(([value, label]) => (
          <button key={value} className={s.mode === value ? 'selected' : ''} onClick={() => switchMode(value)}>
            {label}
          </button>
        ))}
      </div>

      <div className="drill-options">
        {s.mode === 'intervals' ? (
          <>
            <label>
              Quali
              <select
                value={INTERVAL_SETS.find((x) => x.ids.join() === s.intervals.join())?.id ?? 'custom'}
                onChange={(e) => {
                  const chosen = INTERVAL_SETS.find((x) => x.id === e.target.value)
                  if (chosen) set({ intervals: chosen.ids })
                }}
              >
                {INTERVAL_SETS.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
                <option value="custom" disabled>
                  Scelti a mano
                </option>
              </select>
            </label>
            <label>
              Come
              <select value={s.direction} onChange={(e) => set({ direction: e.target.value as IntervalDirection })}>
                <option value="up">Ascendenti</option>
                <option value="down">Discendenti</option>
                <option value="harmonic">Armonici (insieme)</option>
                <option value="mixed">Misti</option>
              </select>
            </label>
          </>
        ) : (
          <>
            {CHORD_GROUPS.map((g) => (
              <label key={g.id} className="drill-check" title={g.name}>
                <input
                  type="checkbox"
                  checked={s.groups.includes(g.id)}
                  onChange={(e) =>
                    set({ groups: e.target.checked ? [...s.groups, g.id] : s.groups.filter((x) => x !== g.id) })
                  }
                />
                {g.id === 'triads' ? 'Triadi' : g.id === 'sevenths' ? 'Settime' : 'Estesi (6, 9, 11, 13)'}
              </label>
            ))}
            <label className="drill-check" title="Triadi e settime anche in 1°, 2° e 3° rivolto">
              <input type="checkbox" checked={s.inversions} onChange={(e) => set({ inversions: e.target.checked })} />
              Rivolti
            </label>
            <label className="drill-check" title="Prima le note una alla volta, poi insieme">
              <input type="checkbox" checked={s.arpeggiate} onChange={(e) => set({ arpeggiate: e.target.checked })} />
              Arpeggiato
            </label>
          </>
        )}
      </div>

      {s.mode === 'intervals' && (
        <div className="ear-picks" aria-label="Intervalli da allenare">
          {INTERVALS.map((i) => (
            <label key={i.id} className={s.intervals.includes(i.id) ? 'on' : ''} title={i.name}>
              <input
                type="checkbox"
                checked={s.intervals.includes(i.id)}
                onChange={(e) =>
                  set({
                    intervals: e.target.checked
                      ? INTERVALS.filter((x) => x.id === i.id || s.intervals.includes(x.id)).map((x) => x.id)
                      : s.intervals.filter((x) => x !== i.id)
                  })
                }
              />
              {i.short}
            </label>
          ))}
        </div>
      )}

      <div className="drill-stage ear-stage">
        <div className="drill-options">
          <button className="primary" disabled={!inTauri} onClick={() => ask()}>
            {question ? 'Prossimo' : 'Inizia'}
          </button>
          <button disabled={!question || !inTauri} onClick={() => question && void sound(question)}>
            ▶ Riascolta
          </button>
          {given && question && !right && (
            <button onClick={() => void sound(asAnswered(question, given))} title="Come suonerebbe la tua risposta">
              ▶ La tua scelta
            </button>
          )}
        </div>

        <div className={`drill-feedback ${given ? (right ? 'right' : 'wrong') : ''}`}>
          {!question
            ? s.mode === 'exact'
              ? 'Prima suona un Do di riferimento, poi l’accordo: trova la tonica e il tipo.'
              : 'Premi Inizia e ascolta.'
            : given
              ? `${right ? 'Giusto' : 'No'}: ${question.explanation}`
              : s.mode === 'intervals'
                ? 'Che intervallo è?'
                : s.mode === 'quality'
                  ? 'Che accordo è?'
                  : root === null
                    ? 'Qual è la tonica? (il primo suono era un Do)'
                    : `${ROOT_NAMES[root]}… e che tipo?`}
        </div>

        {question && s.mode === 'exact' && (
          <div className="ear-answers roots">
            {ROOT_NAMES.map((name, pc) => (
              <button
                key={name}
                disabled={!!given}
                className={`${root === pc ? 'chosen' : ''} ${given && question.answer.startsWith(`${pc}:`) ? 'ear-right' : ''}`}
                onClick={() => setRoot(pc)}
              >
                {name}
              </button>
            ))}
          </div>
        )}

        {question && (
          <div className="ear-answers">
            {s.mode === 'intervals'
              ? intervalChoices.map((i) => (
                  <button key={i.id} disabled={!!given} className={buttonClass(i.id)} onClick={() => answer(i.id)}>
                    {i.name}
                  </button>
                ))
              : chordChoices.map((c) => {
                  const id = s.mode === 'exact' ? `${root ?? 0}:${c.id}` : c.id
                  const correctType = given && question.answer.endsWith(`:${c.id}`)
                  return (
                    <button
                      key={c.id}
                      disabled={!!given || (s.mode === 'exact' && root === null)}
                      className={
                        s.mode === 'exact'
                          ? correctType
                            ? 'ear-right'
                            : given === id
                              ? 'ear-wrong'
                              : ''
                          : buttonClass(c.id)
                      }
                      onClick={() => answer(id)}
                    >
                      {c.name}
                      <small>{c.symbol || 'maj'}</small>
                    </button>
                  )
                })}
          </div>
        )}

        <div className="drill-live">
          {stats.asked > 0 &&
            `${stats.right}/${stats.asked} giuste (${Math.round((stats.right / stats.asked) * 100)}%) · di fila ${stats.streak} · record ${stats.best}`}
        </div>
        {confusions.length > 0 && (
          <div className="ear-confusions">
            {confusions.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
