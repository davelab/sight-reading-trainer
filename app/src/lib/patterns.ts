/**
 * Repeated phrases (Analysis.patterns): naming, colours, loop ranges, and the
 * tinting of their measures in Verovio's SVG.
 */
import type { Pattern } from '../types'
import type { MeasureStart } from './timemap'

const SVG_NS = 'http://www.w3.org/2000/svg'
const MARK = 'pattern-mark'

/** Categorical colours, distinct from the hand and function colours. */
export const PATTERN_COLORS = ['#1a9e8f', '#d6457a', '#3d7be0', '#7cab1e', '#e07b1a', '#8a5cc2', '#9c6b3c', '#16a3c9']

export function patternColor(index: number): string {
  return PATTERN_COLORS[index % PATTERN_COLORS.length]
}

/** "A", "B", … "Z", "AA"… in order of appearance. */
export function patternLetter(index: number): string {
  let s = ''
  let n = index
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

/** "+M2" → "↑M2", "-P5" → "↓P5", "P1" → "". */
export function transpositionLabel(t: string | undefined | null): string {
  if (!t || t === 'P1') return ''
  return (t.startsWith('-') ? '↓' : '↑') + t.replace(/^[+-]/, '')
}

/**
 * Measures (ordinals) that repeat a phrase already seen: every occurrence but
 * the first of each pattern. The "study it once" saving.
 */
export function repeatedMeasures(patterns: readonly Pattern[]): Set<number> {
  const out = new Set<number>()
  for (const p of patterns) {
    for (const start of p.occurrences.slice(1)) {
      for (let m = start; m < start + p.length; m++) out.add(m)
    }
  }
  return out
}

/** Playback range of measures [start, start + length) in score ms, for the A–B loop. */
export function loopRange(
  start: number,
  length: number,
  measureIds: readonly string[],
  measures: readonly MeasureStart[],
  durationMs: number
): { startMs: number; endMs: number } | null {
  const msOf = (ordinal: number): number | undefined => {
    const id = measureIds[ordinal - 1]
    return measures.find((m) => m.measureId === id)?.ms
  }
  const startMs = msOf(start)
  if (startMs === undefined) return null
  const endMs = msOf(start + length) ?? durationMs
  return endMs > startMs ? { startMs, endMs } : null
}

function box(el: Element): DOMRect | null {
  try {
    const b = (el as SVGGraphicsElement).getBBox()
    return b.width || b.height ? b : null
  } catch {
    return null
  }
}

export function clearPatterns(root: ParentNode): void {
  root.querySelectorAll(`.${MARK}`).forEach((el) => el.remove())
}

/**
 * Tint every occurrence: the whole measure for both hands, one staff for one
 * hand. The selected pattern is stronger; the others fade when one is selected.
 */
export function drawPatterns(root: ParentNode, patterns: readonly Pattern[], selected: string | null): void {
  clearPatterns(root)
  const measures = [...root.querySelectorAll('g.measure')]
  patterns.forEach((p, index) => {
    const color = patternColor(index)
    const opacity = selected === null ? 0.16 : selected === p.id ? 0.3 : 0.06
    p.occurrences.forEach((start, occ) => {
      for (let ordinal = start; ordinal < start + p.length; ordinal++) {
        const measure = measures[ordinal - 1]
        if (!measure) continue
        const staves = [...measure.querySelectorAll(':scope > g.staff')]
        const chosen = p.hands === 'right' ? staves.slice(0, 1) : p.hands === 'left' ? staves.slice(1, 2) : staves
        const boxes = chosen.map(box).filter((b): b is DOMRect => b !== null)
        if (!boxes.length) continue
        const x = Math.min(...boxes.map((b) => b.x))
        const y = Math.min(...boxes.map((b) => b.y))
        const w = Math.max(...boxes.map((b) => b.x + b.width)) - x
        const h = Math.max(...boxes.map((b) => b.y + b.height)) - y
        const rect = document.createElementNS(SVG_NS, 'rect')
        rect.setAttribute('class', MARK)
        rect.setAttribute('x', String(x))
        rect.setAttribute('y', String(y))
        rect.setAttribute('width', String(w))
        rect.setAttribute('height', String(h))
        rect.setAttribute('fill', color)
        rect.setAttribute('fill-opacity', String(opacity))
        measure.insertBefore(rect, measure.firstChild)
        if (ordinal === start) {
          const label = document.createElementNS(SVG_NS, 'text')
          label.setAttribute('class', `${MARK} pattern-label`)
          label.setAttribute('x', String(x + 30))
          label.setAttribute('y', String(y - 50))
          label.setAttribute('font-size', '300')
          label.setAttribute('fill', color)
          label.textContent = patternLetter(index) + (occ > 0 ? transpositionLabel(p.transpositions?.[occ]) : '')
          measure.appendChild(label)
        }
      }
    })
  })
}
