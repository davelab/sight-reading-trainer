/**
 * Thin wrapper around the Verovio WASM toolkit: load, render, timemap.
 * The toolkit is a singleton; the module (≈ 7 MB of WASM) is loaded lazily.
 */
import createVerovioModule from 'verovio/wasm'
import { VerovioToolkit } from 'verovio/esm'
import { buildPlaybackEvents, measureStarts, staffMapFromMei, type MeasureStart, type PlaybackEvent } from './timemap'

let toolkitPromise: Promise<VerovioToolkit> | null = null

export function getToolkit(): Promise<VerovioToolkit> {
  toolkitPromise ??= createVerovioModule().then((module) => new VerovioToolkit(module))
  return toolkitPromise
}

export interface RenderOptions {
  widthPx: number
  /** Verovio scale in percent: the SVG is drawn at pageWidth × scale / 100 px. */
  scale: number
}

export interface LoadedScore {
  events: PlaybackEvent[]
  measures: MeasureStart[]
}

export async function loadScore(musicxml: string): Promise<LoadedScore> {
  const tk = await getToolkit()
  tk.setOptions({ breaks: 'auto', adjustPageHeight: true, footer: 'none', header: 'auto' })
  if (!tk.loadData(musicxml)) {
    throw new Error(`Verovio could not read the file: ${tk.getLog() || 'unknown error'}`)
  }
  tk.renderToMIDI() // required before getMIDIValuesForElement
  const timemap = tk.renderToTimemap({ includeMeasures: true })
  const staffs = staffMapFromMei(tk.getMEI())
  const events = buildPlaybackEvents(timemap, (id) => {
    const midi = tk.getMIDIValuesForElement(id)
    if (!midi || typeof midi.pitch !== 'number') return null
    return { pitch: midi.pitch, durMs: midi.duration, staff: staffs.get(id) ?? 1 }
  })
  return { events, measures: measureStarts(timemap) }
}

/** Lay the loaded score out at the given width and return one SVG string per page. */
export async function renderPages({ widthPx, scale }: RenderOptions): Promise<string[]> {
  const tk = await getToolkit()
  const pageWidth = Math.max(800, Math.round((widthPx * 100) / scale))
  tk.setOptions({ pageWidth, scale, pageMarginLeft: 50, pageMarginRight: 50, pageMarginTop: 50 })
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
