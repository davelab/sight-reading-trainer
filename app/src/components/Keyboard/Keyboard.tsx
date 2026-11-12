import { useMemo, useRef, useState } from 'react'
import { inTauri, ipc } from '../../lib/ipc'
import { keyLights } from '../../lib/keyboardState'
import { useMidi } from '../../stores/midi'
import { useScore } from '../../stores/score'
import { useTransport } from '../../stores/transport'
import './Keyboard.css'

const LOW = 21 // A0
const HIGH = 108 // C8
const WHITE_PCS = new Set([0, 2, 4, 5, 7, 9, 11])
const isWhite = (pitch: number) => WHITE_PCS.has(pitch % 12)

const HEIGHT_KEY = 'keyboard-height'
const MIN_HEIGHT = 60
const MAX_HEIGHT = 280
const DEFAULT_HEIGHT = 130

function savedHeight(): number {
  try {
    const h = Number(localStorage.getItem(HEIGHT_KEY))
    return h >= MIN_HEIGHT && h <= MAX_HEIGHT ? h : DEFAULT_HEIGHT
  } catch {
    return DEFAULT_HEIGHT
  }
}

/**
 * On-screen 88-key keyboard.
 * - Notes to play (sounding during playback, expected in follow mode): amber
 *   for the right hand, violet for the left; every new attack flashes the key,
 *   so repeated notes and chords are visible.
 * - Keys held on the MIDI piano: blue; green/red in follow mode for right/wrong.
 * - Clicking a key plays it like a MIDI note. Drag the top edge to resize.
 */
export function Keyboard() {
  const events = useScore((s) => s.events)
  const currentNoteIds = useTransport((s) => s.currentNoteIds)
  const { heldPitches, wrongPitches, following, expectedPitches } = useMidi()
  const pressed = useRef<number | null>(null)
  const [height, setHeight] = useState(savedHeight)

  const eventsById = useMemo(() => new Map(events.map((e) => [e.noteId, e])), [events])
  const lights = keyLights(currentNoteIds, eventsById, following ? expectedPitches : undefined)
  const held = new Set(heldPitches)
  const wrong = new Set(wrongPitches)

  const whites: number[] = []
  const blacks: number[] = []
  for (let p = LOW; p <= HIGH; p++) (isWhite(p) ? whites : blacks).push(p)
  const whiteIndex = (p: number) => whites.filter((w) => w < p).length
  const W = 100 / whites.length

  const cls = (p: number) => {
    if (held.has(p)) return following ? (wrong.has(p) ? 'wrong' : 'correct') : 'played'
    const light = lights.get(p)
    return light ? `lit hand-${light.hand}` : ''
  }

  const press = (p: number) => {
    if (!inTauri) return
    release()
    pressed.current = p
    void ipc.virtualNote(p, true)
  }
  const release = () => {
    if (pressed.current === null) return
    void ipc.virtualNote(pressed.current, false)
    pressed.current = null
  }

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = height
    let latest = startH
    const move = (ev: PointerEvent) => {
      latest = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startH + startY - ev.clientY))
      setHeight(latest)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      try {
        localStorage.setItem(HEIGHT_KEY, String(latest))
      } catch {
        // storage unavailable: the size just is not remembered
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const key = (p: number, color: 'white' | 'black', left: number, width: number) => {
    const light = !held.has(p) ? lights.get(p) : undefined
    return (
      <div
        key={p}
        data-pitch={p}
        className={`key ${color} ${cls(p)}`}
        style={{ left: `${left}%`, width: `${width}%` }}
        onPointerDown={(e) => {
          e.preventDefault()
          press(p)
        }}
        onPointerEnter={(e) => e.buttons === 1 && press(p)}
      >
        {/* Remounted on every new attack: replays the strike animation. */}
        {light && <span key={light.strikeId} className="strike" />}
      </div>
    )
  }

  return (
    <div className="keyboard-wrap" style={{ height }}>
      <div
        className="keyboard-resize"
        onPointerDown={startResize}
        onDoubleClick={() => setHeight(DEFAULT_HEIGHT)}
        title="Trascina per cambiare l'altezza (doppio clic: predefinita)"
      />
      <div className="keyboard" aria-label="Tastiera" onPointerUp={release} onPointerLeave={release}>
        {whites.map((p, i) => key(p, 'white', i * W, W))}
        {blacks.map((p) => key(p, 'black', whiteIndex(p) * W - W * 0.3, W * 0.6))}
      </div>
    </div>
  )
}
