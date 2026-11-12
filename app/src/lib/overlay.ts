/**
 * Cursor and annotation overlay on Verovio's SVG.
 * M1: highlight the notes currently sounding. M3/M4 will add chords, keys and
 * pattern colours, anchored to (measure, beat) — never to note IDs.
 */

const PLAYING = 'playing'
const LEFT_HAND = 'hand-left'

/**
 * Swap the highlighted notes; returns the ids now highlighted. Notes for which
 * `isLeftHand` is true get the left-hand colour.
 */
export function highlightNotes(
  root: ParentNode,
  previous: readonly string[],
  next: readonly string[],
  isLeftHand: (id: string) => boolean = () => false
): string[] {
  const keep = new Set(next)
  for (const id of previous) {
    if (!keep.has(id)) root.querySelector(`[id="${CSS.escape(id)}"]`)?.classList.remove(PLAYING, LEFT_HAND)
  }
  for (const id of next) {
    const el = root.querySelector(`[id="${CSS.escape(id)}"]`)
    el?.classList.add(PLAYING)
    el?.classList.toggle(LEFT_HAND, isLeftHand(id))
  }
  return [...next]
}

/** Scroll the container so the first highlighted note stays in view. */
export function followCursor(container: HTMLElement, noteId: string | undefined): void {
  if (!noteId) return
  const el = container.querySelector(`[id="${CSS.escape(noteId)}"]`)
  if (!el) return
  const box = el.getBoundingClientRect()
  const view = container.getBoundingClientRect()
  const margin = view.height * 0.25
  if (box.top < view.top + margin * 0.5 || box.bottom > view.bottom - margin) {
    container.scrollBy({ top: box.top - view.top - margin, behavior: 'smooth' })
  }
}

const MARK = 'follow-mark'

/** Union of the measure's staves: excludes tempo marks, dynamics and lyrics around them. */
function staffBox(measure: SVGGraphicsElement): DOMRect | null {
  const staves = measure.querySelectorAll<SVGGraphicsElement>(':scope > g.staff')
  const boxes = (staves.length ? [...staves] : [measure]).map((el) => el.getBBox())
  if (!boxes.length) return null
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  const right = Math.max(...boxes.map((b) => b.x + b.width))
  const bottom = Math.max(...boxes.map((b) => b.y + b.height))
  return new DOMRect(x, y, right - x, bottom - y)
}

export interface MeasureMark {
  measureId: string
  /** "ok" = no wrong notes, "err" = at least one. */
  status: 'ok' | 'err'
  title: string
}

/**
 * Tint each judged measure behind its notes (follow mode results).
 * Replaces any previous marks; call again after every re-render.
 */
export function markMeasures(root: ParentNode, marks: readonly MeasureMark[]): void {
  root.querySelectorAll(`.${MARK}`).forEach((el) => el.remove())
  for (const mark of marks) {
    const measure = root.querySelector<SVGGraphicsElement>(`g.measure[id="${CSS.escape(mark.measureId)}"]`)
    if (!measure) continue
    const box = staffBox(measure)
    if (!box) continue
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('class', `${MARK} ${mark.status}`)
    rect.setAttribute('x', String(box.x))
    rect.setAttribute('y', String(box.y))
    rect.setAttribute('width', String(box.width))
    rect.setAttribute('height', String(box.height))
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
    title.textContent = mark.title
    rect.appendChild(title)
    measure.insertBefore(rect, measure.firstChild) // first child: drawn under the notes
  }
}
