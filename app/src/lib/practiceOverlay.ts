/**
 * Sight-reading overlays on Verovio's SVG:
 * - the look-ahead mask, over the measure being played (and the next one);
 * - reading aids: note names, melodic intervals from a third up, chord shapes.
 * Notes are found by id only to place text next to them; what is written comes
 * from the notes' own spelling and pitch.
 */
import { chordShape, diatonicInterval, intervalLabel, noteName, type Spelling } from './practice'
import type { PlaybackEvent } from './timemap'

const SVG_NS = 'http://www.w3.org/2000/svg'
const MASK = 'lookahead-mask'
const AID = 'reading-aid'

function bbox(el: Element | null): DOMRect | null {
  try {
    const b = el ? (el as SVGGraphicsElement).getBBox() : null
    return b && (b.width || b.height) ? b : null
  } catch {
    return null
  }
}

function staffBox(measure: Element): DOMRect | null {
  const boxes = [...measure.querySelectorAll(':scope > g.staff')].map(bbox).filter((b): b is DOMRect => b !== null)
  if (!boxes.length) return null
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  return new DOMRect(
    x,
    y,
    Math.max(...boxes.map((b) => b.x + b.width)) - x,
    Math.max(...boxes.map((b) => b.y + b.height)) - y
  )
}

export function clearLookahead(root: ParentNode): void {
  root.querySelectorAll(`.${MASK}`).forEach((el) => el.remove())
}

/** Cover the measure holding `noteId` (and, with `next`, the following one in the same system). */
export function drawLookahead(root: ParentNode, noteId: string | undefined, next: boolean): void {
  clearLookahead(root)
  if (!noteId) return
  const note = root.querySelector(`[id="${CSS.escape(noteId)}"]`)
  const measure = note?.closest('g.measure')
  const system = measure?.closest('g.system')
  if (!measure || !system) return
  const measures = [...system.querySelectorAll('g.measure')]
  const i = measures.indexOf(measure)
  const covered = measures.slice(i, next ? i + 2 : i + 1)
  const boxes = covered.map(staffBox).filter((b): b is DOMRect => b !== null)
  if (!boxes.length) return
  const pad = boxes[0].height * 0.08
  const x = Math.min(...boxes.map((b) => b.x))
  const right = Math.max(...boxes.map((b) => b.x + b.width))
  const rect = document.createElementNS(SVG_NS, 'rect')
  rect.setAttribute('class', MASK)
  rect.setAttribute('x', String(x))
  rect.setAttribute('y', String(boxes[0].y - pad))
  rect.setAttribute('width', String(right - x))
  rect.setAttribute('height', String(boxes[0].height + 2 * pad))
  system.appendChild(rect) // last: over the notes
}

export interface AidOptions {
  noteNames: boolean
  intervals: boolean
  chordShapes: boolean
}

export function clearAids(root: ParentNode): void {
  root.querySelectorAll(`.${AID}`).forEach((el) => el.remove())
}

function label(parent: Element, x: number, y: number, size: number, content: string, cls: string): void {
  const t = document.createElementNS(SVG_NS, 'text')
  t.setAttribute('x', String(x))
  t.setAttribute('y', String(y))
  t.setAttribute('font-size', String(size))
  t.setAttribute('text-anchor', 'middle')
  t.setAttribute('class', `${AID} ${cls}`)
  t.textContent = content
  parent.appendChild(t)
}

/** Draw the chosen reading aids next to the notes. */
export function drawAids(
  root: ParentNode,
  options: AidOptions,
  spellings: ReadonlyMap<string, Spelling>,
  events: readonly PlaybackEvent[]
): void {
  clearAids(root)
  if (!options.noteNames && !options.intervals && !options.chordShapes) return
  const heads = new Map<string, { el: Element; box: DOMRect }>()
  const head = (id: string) => {
    if (!heads.has(id)) {
      const el = root.querySelector(`g.note[id="${CSS.escape(id)}"]`)
      const box = bbox(el?.querySelector('.notehead') ?? null)
      if (el && box) heads.set(id, { el, box })
    }
    return heads.get(id)
  }
  if (options.noteNames) {
    for (const e of events) {
      const s = spellings.get(e.noteId)
      const h = head(e.noteId)
      if (!s || !h) continue
      label(
        h.el,
        h.box.x + h.box.width / 2,
        h.box.y + h.box.height * 2.1,
        h.box.height * 0.9,
        noteName(s, e.pitch),
        'aid-name'
      )
    }
  }
  // Notes by staff and onset: chords, and the melody (top of the right hand, bottom of the left).
  const byStaff = new Map<number, Map<number, PlaybackEvent[]>>()
  for (const e of events) {
    if (!spellings.has(e.noteId)) continue
    const staff = byStaff.get(e.staff) ?? new Map<number, PlaybackEvent[]>()
    byStaff.set(e.staff, staff)
    const at = Math.round(e.onsetMs)
    staff.set(at, [...(staff.get(at) ?? []), e])
  }
  for (const [staff, onsets] of byStaff) {
    const times = [...onsets.keys()].sort((a, b) => a - b)
    const upper = staff < 2
    let previous: PlaybackEvent | null = null
    for (const t of times) {
      const notes = onsets.get(t)!.sort((a, b) => a.pitch - b.pitch)
      const melody = upper ? notes[notes.length - 1] : notes[0]
      const h = head(melody.noteId)
      const interval =
        previous && h ? diatonicInterval(spellings.get(previous.noteId)!, spellings.get(melody.noteId)!) : 0
      // Skips and leaps only: steps (seconds) and repeated notes read by themselves.
      if (options.intervals && h && Math.abs(interval) >= 3) {
        const y = upper ? h.box.y - h.box.height * 1.6 : h.box.y + h.box.height * (options.noteNames ? 3.4 : 2.4)
        label(h.el, h.box.x + h.box.width / 2, y, h.box.height * 0.85, intervalLabel(interval), 'aid-interval')
      }
      if (options.chordShapes && notes.length >= 3) {
        const shape = chordShape(notes.map((n) => spellings.get(n.noteId)!))
        const top = head(notes[notes.length - 1].noteId)
        if (shape && top) {
          label(
            top.el,
            top.box.x + top.box.width / 2,
            top.box.y - top.box.height * 2.8,
            top.box.height * 0.85,
            shape,
            'aid-shape'
          )
        }
      }
      previous = melody
    }
  }
}
