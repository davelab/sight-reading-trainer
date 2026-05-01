import { useEffect, useRef } from 'react'
import { Renderer, Stave, StaveNote, Voice, Formatter, Barline } from 'vexflow'
import type { MelodyNote, Clef, NoteResult } from '../types'

interface SheetMusicProps {
  notes: MelodyNote[]
  clef: Clef
  numMeasures: number
  activeNoteIndex: number
  noteResults: NoteResult[]
}

const NOTE_COLORS: Record<NonNullable<NoteResult>, string> = {
  correct: '#22c55e',
  incorrect: '#ef4444',
  missed: '#64748b',
}
const ACTIVE_COLOR = '#3b82f6'
const DEFAULT_COLOR = '#e2e8f0'

function noteColor(index: number, activeNoteIndex: number, result: NoteResult): string {
  if (result) return NOTE_COLORS[result]
  if (index === activeNoteIndex) return ACTIVE_COLOR
  return DEFAULT_COLOR
}

export function SheetMusic({ notes, clef, numMeasures, activeNoteIndex, noteResults }: SheetMusicProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el || notes.length === 0) return

    el.innerHTML = ''

    const CANVAS_HEIGHT = 200
    const CANVAS_WIDTH = el.clientWidth || 860
    const STAVE_TOP = 50
    const FIRST_STAVE_EXTRA = 80 // space for clef + time sig
    const usableWidth = CANVAS_WIDTH - 20
    const staveWidth = usableWidth / numMeasures

    const renderer = new Renderer(el, Renderer.Backends.SVG)
    renderer.resize(CANVAS_WIDTH, CANVAS_HEIGHT)
    const ctx = renderer.getContext()
    ctx.setFont('Arial', 10)

    // Group notes by measure
    const byMeasure: MelodyNote[][] = Array.from({ length: numMeasures }, () => [])
    for (const note of notes) {
      if (note.measureIndex < numMeasures) byMeasure[note.measureIndex].push(note)
    }

    // Build a global index map for coloring
    const globalIndexMap = new Map<string, number>()
    notes.forEach((n, i) => globalIndexMap.set(n.id, i))

    for (let m = 0; m < numMeasures; m++) {
      const x = 10 + m * staveWidth
      const isFirst = m === 0
      const w = isFirst ? staveWidth : staveWidth

      const stave = new Stave(x, STAVE_TOP, w)
      if (isFirst) {
        stave.addClef(clef).addTimeSignature('4/4')
      }
      if (m === numMeasures - 1) {
        stave.setEndBarType(Barline.type.END)
      }
      stave.setContext(ctx).draw()

      const measureNotes = byMeasure[m]
      if (measureNotes.length === 0) continue

      const staveNotes = measureNotes.map((note) => {
        const globalIdx = globalIndexMap.get(note.id) ?? -1
        const result = noteResults[globalIdx] ?? null
        const color = noteColor(globalIdx, activeNoteIndex, result)

        const sn = new StaveNote({
          clef,
          keys: [note.vexKey],
          duration: note.duration,
        })
        sn.setStyle({ fillStyle: color, strokeStyle: color })

        // Highlight active note with a stronger visual cue
        if (globalIdx === activeNoteIndex && !result) {
          sn.setStyle({ fillStyle: ACTIVE_COLOR, strokeStyle: ACTIVE_COLOR })
        }

        return sn
      })

      const voice = new Voice({ num_beats: 4, beat_value: 4 })
      voice.setMode(Voice.Mode.SOFT)
      voice.addTickables(staveNotes)

      const noteAreaWidth = isFirst ? w - FIRST_STAVE_EXTRA : w - 20
      new Formatter().joinVoices([voice]).format([voice], noteAreaWidth)
      voice.draw(ctx, stave)
    }
  }, [notes, clef, numMeasures, activeNoteIndex, noteResults])

  return (
    <div
      ref={containerRef}
      className="sheet-music-container"
      aria-label="Sheet music notation"
    />
  )
}
