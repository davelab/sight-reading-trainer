/**
 * Cursor and annotation overlay on Verovio's SVG.
 * M1: highlight the notes currently sounding. M3/M4 will add chords, keys and
 * pattern colours, anchored to (measure, beat) — never to note IDs.
 */

const PLAYING = 'playing'

/** Swap the highlighted notes; returns the ids now highlighted. */
export function highlightNotes(root: ParentNode, previous: readonly string[], next: readonly string[]): string[] {
  const keep = new Set(next)
  for (const id of previous) {
    if (!keep.has(id)) root.querySelector(`[id="${CSS.escape(id)}"]`)?.classList.remove(PLAYING)
  }
  for (const id of next) root.querySelector(`[id="${CSS.escape(id)}"]`)?.classList.add(PLAYING)
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
