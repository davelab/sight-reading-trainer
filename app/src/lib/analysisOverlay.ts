/**
 * Harmonic analysis drawn into Verovio's SVG: chord symbols above the system,
 * roman numerals below it (coloured by function), the key at each region start.
 *
 * Anchoring is by position, never by note ID: the n-th `g.measure` in document
 * order is measure ordinal n, and the x position comes from the notes that
 * start at `offset` quarters into that measure (interpolated between onsets).
 */
import type { Analysis, Chord, KeyRegion } from '../types'
import type { MeasureOnset } from './timemap'

const SVG_NS = 'http://www.w3.org/2000/svg'
const MARK = 'analysis-mark'
const DEFAULT_STAFF_SPACE = 180 // Verovio internal units at the default size

export interface AnalysisDisplayOptions {
  roman: boolean
  symbols: boolean
  functions: boolean
}

export interface RomanParts {
  numeral: string
  upper: string
  lower: string
  /** Secondary target, e.g. "/V". */
  applied: string
}

/** Split "V65/V" into numeral "V", figures 6 over 5, and "/V". */
export function splitRoman(figure: string): RomanParts {
  const m = /^([b#]*(?:[ivIV]+)[o+ø]?)(\d{0,2})(\/.+)?$/.exec(figure)
  if (!m) return { numeral: figure, upper: '', lower: '', applied: '' }
  const [, numeral, digits, applied = ''] = m
  return { numeral, upper: digits.slice(0, 1), lower: digits.slice(1, 2), applied }
}

/** "G:" for G major, "e:" for E minor (the usual analysis convention). */
export function keyLabel(k: KeyRegion): string {
  return `${k.mode === 'minor' ? k.tonic.toLowerCase() : k.tonic}:`
}

function box(el: Element): DOMRect | null {
  try {
    const b = (el as SVGGraphicsElement).getBBox()
    return b.width || b.height ? b : null
  } catch {
    return null
  }
}

function noteX(measure: Element, noteIds: string[]): number | null {
  const xs = noteIds.flatMap((id) => {
    const note = measure.querySelector(`[id="${CSS.escape(id)}"]`)
    const head = note?.querySelector('.notehead') ?? note
    const b = head ? box(head) : null
    return b ? [b.x] : []
  })
  return xs.length ? Math.min(...xs) : null
}

function xAt(measure: Element, onsets: MeasureOnset[] | undefined, offset: number, fallback: number): number {
  const placed = (onsets ?? []).flatMap((o) => {
    const x = noteX(measure, o.noteIds)
    return x === null ? [] : [{ q: o.q, x }]
  })
  const exact = placed.find((p) => Math.abs(p.q - offset) < 1e-3)
  if (exact) return exact.x
  const before = [...placed].reverse().find((p) => p.q < offset)
  const after = placed.find((p) => p.q > offset)
  if (before && after) return before.x + ((after.x - before.x) * (offset - before.q)) / (after.q - before.q)
  return before?.x ?? after?.x ?? fallback
}

function staffSpace(staff: Element): number {
  const ys = [...staff.querySelectorAll(':scope > path')].flatMap((p) => {
    const b = box(p)
    return b && b.height < 1 ? [b.y] : [] // horizontal staff lines only
  })
  return ys.length >= 5 ? (Math.max(...ys) - Math.min(...ys)) / 4 : DEFAULT_STAFF_SPACE
}

function text(x: number, y: number, size: number, cls: string): SVGTextElement {
  const t = document.createElementNS(SVG_NS, 'text')
  t.setAttribute('x', String(x))
  t.setAttribute('y', String(y))
  t.setAttribute('font-size', String(size))
  t.setAttribute('class', `${MARK} ${cls}`)
  return t
}

function tspan(content: string, attrs: Record<string, string> = {}): SVGTSpanElement {
  const t = document.createElementNS(SVG_NS, 'tspan')
  t.textContent = content
  for (const [k, v] of Object.entries(attrs)) t.setAttribute(k, v)
  return t
}

function romanText(chord: Chord, key: KeyRegion | null, x: number, y: number, size: number, functions: boolean) {
  const t = text(x, y, size, `roman${functions ? ` fn-${chord.function}` : ''}`)
  if (key) t.appendChild(tspan(`${keyLabel(key)} `, { class: 'key' }))
  const r = splitRoman(chord.roman)
  t.appendChild(tspan(r.numeral))
  if (r.upper && r.lower) {
    // Stacked figured-bass digits: 6 over 5.
    t.appendChild(tspan(r.upper, { dy: String(-size * 0.45), 'font-size': String(size * 0.62) }))
    t.appendChild(tspan(r.lower, { dx: String(-size * 0.36), dy: String(size * 0.6), 'font-size': String(size * 0.62) }))
    if (r.applied) t.appendChild(tspan(r.applied, { dy: String(-size * 0.15) }))
  } else {
    if (r.upper) t.appendChild(tspan(r.upper, { dy: String(-size * 0.45), 'font-size': String(size * 0.62) }))
    if (r.applied) t.appendChild(tspan(r.applied, { dy: r.upper ? String(size * 0.45) : '0' }))
  }
  const title = document.createElementNS(SVG_NS, 'title')
  title.textContent = `${chord.symbol} · ${chord.roman} · ${chord.function}`
  t.appendChild(title)
  return t
}

/** Extra room between systems (MEI units) so annotation rows do not collide. */
export function systemSpacingFor(display: AnalysisDisplayOptions, hasAnalysis: boolean): number {
  if (!hasAnalysis) return 4
  return 4 + (display.roman ? 8 : 0) + (display.symbols ? 6 : 0)
}

/** Top and bottom of the staves of a whole system: annotation rows stay level. */
function systemExtent(system: Element): { top: number; bottom: number } | null {
  const boxes = [...system.querySelectorAll('g.measure > g.staff')].map(box).filter((b): b is DOMRect => b !== null)
  if (!boxes.length) return null
  return { top: Math.min(...boxes.map((b) => b.y)), bottom: Math.max(...boxes.map((b) => b.y + b.height)) }
}

export function clearAnalysis(root: ParentNode): void {
  root.querySelectorAll(`.${MARK}`).forEach((el) => el.remove())
}

export function drawAnalysis(
  root: ParentNode,
  analysis: Analysis,
  onsets: Map<string, MeasureOnset[]>,
  display: AnalysisDisplayOptions
): void {
  clearAnalysis(root)
  if (!display.roman && !display.symbols) return
  const measures = [...root.querySelectorAll('g.measure')]
  const keyStarts = new Map((analysis.key ?? []).map((k) => [k.fromMeasure, k]))
  const keyShown = new Set<number>()
  const extents = new Map<Element, { top: number; bottom: number } | null>()

  for (const chord of analysis.chords ?? []) {
    const measure = measures[chord.measure - 1]
    if (!measure) continue
    const staves = [...measure.querySelectorAll(':scope > g.staff')]
    const boxes = staves.map(box).filter((b): b is DOMRect => b !== null)
    if (!boxes.length) continue
    const space = staffSpace(staves[0])
    const size = space * 1.7
    const system = measure.closest('g.system')
    if (system && !extents.has(system)) extents.set(system, systemExtent(system))
    const extent = (system && extents.get(system)) || {
      top: Math.min(...boxes.map((b) => b.y)),
      bottom: Math.max(...boxes.map((b) => b.y + b.height))
    }
    const { top, bottom } = extent
    const x = xAt(measure, onsets.get(measure.id), chord.offset ?? 0, Math.min(...boxes.map((b) => b.x)) + space)

    if (display.symbols) {
      const t = text(x, top - space * 1.2, size * 0.72, 'symbol')
      t.textContent = chord.symbol
      measure.appendChild(t)
    }
    if (display.roman) {
      const region = keyStarts.get(chord.measure)
      const key = region && !keyShown.has(chord.measure) ? region : null
      if (key) keyShown.add(chord.measure)
      measure.appendChild(romanText(chord, key, x, bottom + space * 3.2, size, display.functions))
    }
  }
}
