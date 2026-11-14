/**
 * Harmonic analysis drawn into Verovio's SVG: one row of chord labels below each
 * system, in the style the user picked (lib/chordLabels.ts), optionally coloured
 * by function, with the key where each key region starts.
 *
 * Anchoring is by position, never by note ID: the n-th `g.measure` in document
 * order is measure ordinal n, and the x position comes from the notes that
 * start at `offset` quarters into that measure (interpolated between onsets).
 */
import type { Analysis, Chord, KeyRegion } from '../types'
import { type ChordLabelStyle, FUNCTION_NAMES, chordLabel, showsKey } from './chordLabels'
import type { MeasureOnset } from './timemap'

const SVG_NS = 'http://www.w3.org/2000/svg'
const MARK = 'analysis-mark'
const DEFAULT_STAFF_SPACE = 180 // Verovio internal units at the default size

export interface AnalysisDisplayOptions {
  /** Show the chord row at all. */
  chords: boolean
  labelStyle: ChordLabelStyle
  /** Colour labels by harmonic function. */
  functions: boolean
}

export interface RomanParts {
  numeral: string
  upper: string
  lower: string
  /** Secondary target, e.g. "/V". */
  applied: string
  /** Altered figures written apart, e.g. "♯6" for "ii#642". */
  altered: string
}

/** Split "V65/V" into numeral "V", figures 6 over 5, and "/V"; "ii#642" into ii, 4 over 2, and ♯6. */
export function splitRoman(figure: string): RomanParts {
  const m = /^([b#]*(?:[ivIV]+)[o+ø]?)((?:[#b]?\d){0,3})(\/.+)?$/.exec(figure)
  const whole = { numeral: figure, upper: '', lower: '', applied: '', altered: '' }
  if (!m) return whole
  const [, numeral, digits, applied = ''] = m
  const tokens = digits.match(/[#b]?\d/g) ?? []
  const plain = tokens.filter((t) => t.length === 1)
  const altered = tokens.filter((t) => t.length === 2).map((t) => t.replace('#', '♯').replace('b', '♭'))
  if (plain.length > 2) return whole
  return { numeral, upper: plain[0] ?? '', lower: plain[1] ?? '', applied, altered: altered.join(' ') }
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
  t.appendChild(tspan(r.numeral.replace(/^b/, '♭').replace(/^#/, '♯').replace('o', '°')))
  if (r.altered) t.appendChild(tspan(`(${r.altered})`, { 'font-size': String(size * 0.62) }))
  if (r.upper && r.lower) {
    // Stacked figured-bass digits: 6 over 5.
    t.appendChild(tspan(r.upper, { dy: String(-size * 0.45), 'font-size': String(size * 0.62) }))
    t.appendChild(
      tspan(r.lower, { dx: String(-size * 0.36), dy: String(size * 0.6), 'font-size': String(size * 0.62) })
    )
    if (r.applied) t.appendChild(tspan(r.applied, { dy: String(-size * 0.15) }))
  } else {
    if (r.upper) t.appendChild(tspan(r.upper, { dy: String(-size * 0.45), 'font-size': String(size * 0.62) }))
    if (r.applied) t.appendChild(tspan(r.applied, { dy: r.upper ? String(size * 0.45) : '0' }))
  }
  t.appendChild(tooltip(chord))
  return t
}

function tooltip(chord: Chord): SVGTitleElement {
  const title = document.createElementNS(SVG_NS, 'title')
  const fn = chord.function === 'other' ? '' : ` · ${FUNCTION_NAMES[chord.function]}`
  title.textContent = `${chordLabel(chord, 'names')} (${chordLabel(chord, 'symbols')}) · ${chord.roman}${fn}`
  return title
}

function labelText(
  chord: Chord,
  key: KeyRegion | null,
  style: ChordLabelStyle,
  x: number,
  y: number,
  size: number,
  functions: boolean
): SVGTextElement {
  const t = text(
    x,
    y,
    size,
    `chord-label${style === 'functions' ? ' fn-letter' : ''}${functions ? ` fn-${chord.function}` : ''}`
  )
  if (key) t.appendChild(tspan(`${keyLabel(key)} `, { class: 'key' }))
  t.appendChild(tspan(chordLabel(chord, style)))
  t.appendChild(tooltip(chord))
  return t
}

/** Extra room between systems (MEI units) so annotation rows do not collide. */
export function systemSpacingFor(display: AnalysisDisplayOptions, hasAnalysis: boolean): number {
  if (!hasAnalysis) return 4
  return 4 + (display.chords ? 8 : 0)
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
  if (!display.chords) return
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
    const { bottom } = extent
    const x = xAt(measure, onsets.get(measure.id), chord.offset ?? 0, Math.min(...boxes.map((b) => b.x)) + space)

    const region = showsKey(display.labelStyle) ? keyStarts.get(chord.measure) : undefined
    const key = region && !keyShown.has(chord.measure) ? region : null
    if (key) keyShown.add(chord.measure)
    const y = bottom + space * 3.2
    measure.appendChild(
      display.labelStyle === 'roman'
        ? romanText(chord, key, x, y, size, display.functions)
        : labelText(
            chord,
            key,
            display.labelStyle,
            x,
            y,
            size * (display.labelStyle === 'functions' ? 1 : 0.8),
            display.functions
          )
    )
  }
}
