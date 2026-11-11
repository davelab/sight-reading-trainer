import { useMemo, useRef } from 'react'
import { inTauri, ipc } from '../../lib/ipc'
import { useMidi } from '../../stores/midi'
import { useScore } from '../../stores/score'
import { useTransport } from '../../stores/transport'
import './Keyboard.css'

const LOW = 21 // A0
const HIGH = 108 // C8
const WHITE_PCS = new Set([0, 2, 4, 5, 7, 9, 11])
const isWhite = (pitch: number) => WHITE_PCS.has(pitch % 12)

/**
 * On-screen 88-key keyboard. Yellow: notes to play (sounding during playback,
 * expected in follow mode). Blue: keys held on the MIDI piano; green/red in
 * follow mode for right/wrong. Clicking a key plays it like a MIDI note.
 */
export function Keyboard() {
  const events = useScore((s) => s.events)
  const currentNoteIds = useTransport((s) => s.currentNoteIds)
  const { heldPitches, wrongPitches, following, expectedPitches } = useMidi()
  const pressed = useRef<number | null>(null)

  const pitchById = useMemo(() => new Map(events.map((e) => [e.noteId, e.pitch])), [events])
  const expected = new Set(
    following ? expectedPitches : currentNoteIds.map((id) => pitchById.get(id)).filter((p) => p !== undefined)
  )
  const held = new Set(heldPitches)
  const wrong = new Set(wrongPitches)

  const whites: number[] = []
  const blacks: number[] = []
  for (let p = LOW; p <= HIGH; p++) (isWhite(p) ? whites : blacks).push(p)
  const whiteIndex = (p: number) => whites.filter((w) => w < p).length
  const W = 100 / whites.length

  const cls = (p: number) => {
    if (held.has(p)) return following ? (wrong.has(p) ? 'wrong' : 'right') : 'played'
    return expected.has(p) ? 'expected' : ''
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

  const key = (p: number, color: 'white' | 'black', left: number, width: number) => (
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
    />
  )

  return (
    <div className="keyboard" aria-label="Tastiera" onPointerUp={release} onPointerLeave={release}>
      {whites.map((p, i) => key(p, 'white', i * W, W))}
      {blacks.map((p) => key(p, 'black', whiteIndex(p) * W - W * 0.3, W * 0.6))}
    </div>
  )
}
