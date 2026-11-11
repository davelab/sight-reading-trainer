import { useMemo } from 'react'
import { useMidi } from '../../stores/midi'
import { useScore } from '../../stores/score'
import { useTransport } from '../../stores/transport'
import './Keyboard.css'

const LOW = 21 // A0
const HIGH = 108 // C8
const WHITE_PCS = new Set([0, 2, 4, 5, 7, 9, 11])
const isWhite = (pitch: number) => WHITE_PCS.has(pitch % 12)

/**
 * On-screen 88-key keyboard. M1 shows the expected (sounding) notes;
 * M2 adds the notes played on the MIDI piano.
 */
export function Keyboard() {
  const events = useScore((s) => s.events)
  const currentNoteIds = useTransport((s) => s.currentNoteIds)
  const held = useMidi((s) => s.heldPitches)

  const pitchById = useMemo(() => new Map(events.map((e) => [e.noteId, e.pitch])), [events])
  const expected = new Set(currentNoteIds.map((id) => pitchById.get(id)).filter((p) => p !== undefined))
  const played = new Set(held)

  const whites: number[] = []
  const blacks: number[] = []
  for (let p = LOW; p <= HIGH; p++) (isWhite(p) ? whites : blacks).push(p)
  const whiteIndex = (p: number) => whites.filter((w) => w < p).length
  const W = 100 / whites.length

  const cls = (p: number) => (played.has(p) ? 'played' : expected.has(p) ? 'expected' : '')

  return (
    <div className="keyboard" aria-label="Tastiera">
      {whites.map((p, i) => (
        <div key={p} className={`key white ${cls(p)}`} style={{ left: `${i * W}%`, width: `${W}%` }} />
      ))}
      {blacks.map((p) => (
        <div key={p} className={`key black ${cls(p)}`} style={{ left: `${whiteIndex(p) * W - W * 0.3}%`, width: `${W * 0.6}%` }} />
      ))}
    </div>
  )
}
