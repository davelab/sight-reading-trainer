/**
 * Thin wrapper around the Verovio WASM toolkit: load, render, timemap.
 * The toolkit is a singleton; the module (≈ 7 MB of WASM) is loaded lazily.
 */
import createVerovioModule from 'verovio/wasm'
import { VerovioToolkit } from 'verovio/esm'
import {
  assignMeasures,
  buildPlaybackEvents,
  measureIdsFromMei,
  measureLabelsFromMei,
  measureOnsets,
  measureStarts,
  staffMapFromMei,
  type MeasureOnset,
  type MeasureStart,
  type PlaybackEvent
} from './timemap'

let toolkitPromise: Promise<VerovioToolkit> | null = null

export function getToolkit(): Promise<VerovioToolkit> {
  toolkitPromise ??= createVerovioModule().then((module) => new VerovioToolkit(module))
  return toolkitPromise
}

export interface RenderOptions {
  widthPx: number
  /** Verovio scale in percent: the SVG is drawn at pageWidth × scale / 100 px. */
  scale: number
  /** Minimal space between systems in MEI units (half staff spaces); Verovio's default is 4. */
  spacingSystem?: number
}

export interface LoadedScore {
  events: PlaybackEvent[]
  measures: MeasureStart[]
  onsets: Map<string, MeasureOnset[]>
  /** Printed measure number by ordinal - 1. */
  measureLabels: string[]
  /** Measure xml:id by ordinal - 1. */
  measureIds: string[]
}

export async function loadScore(musicxml: string): Promise<LoadedScore> {
  const tk = await getToolkit()
  tk.setOptions({ breaks: 'auto', adjustPageHeight: true, footer: 'none', header: 'auto' })
  if (!tk.loadData(musicxml)) {
    throw new Error(`Verovio could not read the file: ${tk.getLog() || 'unknown error'}`)
  }
  tk.renderToMIDI() // required before getMIDIValuesForElement
  const timemap = tk.renderToTimemap({ includeMeasures: true })
  const mei = tk.getMEI()
  const staffs = staffMapFromMei(mei)
  const events = buildPlaybackEvents(timemap, (id) => {
    const midi = tk.getMIDIValuesForElement(id)
    if (!midi || typeof midi.pitch !== 'number') return null
    return { pitch: midi.pitch, durMs: midi.duration, staff: staffs.get(id) ?? 1 }
  })
  const measures = measureStarts(timemap)
  return {
    events: assignMeasures(events, measures),
    measures,
    onsets: measureOnsets(timemap),
    measureLabels: measureLabelsFromMei(mei),
    measureIds: measureIdsFromMei(mei)
  }
}

/** Lay the loaded score out at the given width and return one SVG string per page. */
export async function renderPages({ widthPx, scale, spacingSystem = 4 }: RenderOptions): Promise<string[]> {
  const tk = await getToolkit()
  const pageWidth = Math.max(800, Math.round((widthPx * 100) / scale))
  tk.setOptions({ pageWidth, scale, spacingSystem, pageMarginLeft: 50, pageMarginRight: 50, pageMarginTop: 50 })
  tk.redoLayout()
  const pages: string[] = []
  for (let p = 1; p <= tk.getPageCount(); p++) pages.push(tk.renderToSVG(p))
  return pages
}

export async function timeForNote(noteId: string): Promise<number | null> {
  const tk = await getToolkit()
  const ms = tk.getTimeForElement(noteId)
  return Number.isFinite(ms) ? ms : null
}
