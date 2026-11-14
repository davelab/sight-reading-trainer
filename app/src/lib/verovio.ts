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
  mergeTies,
  staffMapFromMei,
  tiesFromMei,
  type MeasureOnset,
  type MeasureStart,
  type PlaybackEvent
} from './timemap'
import { metersFromMei, spellingsFromMei, type Meter, type Spelling } from './practice'

let modulePromise: ReturnType<typeof createVerovioModule> | null = null
let toolkitPromise: Promise<VerovioToolkit> | null = null
let drillToolkitPromise: Promise<VerovioToolkit> | null = null

function getModule(): ReturnType<typeof createVerovioModule> {
  modulePromise ??= createVerovioModule()
  return modulePromise
}

export function getToolkit(): Promise<VerovioToolkit> {
  toolkitPromise ??= getModule().then((module) => new VerovioToolkit(module))
  return toolkitPromise
}

/**
 * Render a small standalone MusicXML (a drill question) to one SVG, with its own
 * toolkit: the score loaded in the main one is left alone.
 */
export async function renderSnippet(musicxml: string, scale = 90, pageWidth = 1400): Promise<string> {
  const tk = await getAuxToolkit()
  tk.setOptions({
    scale,
    pageWidth,
    adjustPageHeight: true,
    adjustPageWidth: true,
    header: 'none',
    footer: 'none',
    pageMarginTop: 20,
    pageMarginBottom: 20,
    pageMarginLeft: 20,
    pageMarginRight: 20
  })
  if (!tk.loadData(musicxml)) throw new Error('esercizio non disegnabile')
  return tk.renderToSVG(1)
}

export interface RenderOptions {
  widthPx: number
  /** Verovio scale in percent: the SVG is drawn at pageWidth × scale / 100 px. */
  scale: number
  /** Minimal space between systems in MEI units (half staff spaces); Verovio's default is 4. */
  spacingSystem?: number
}

export interface LoadedScore {
  /** What is played: a tied note once, for its whole length. */
  events: PlaybackEvent[]
  /** Every written note, tie continuations included (to find notes to correct). */
  writtenEvents: PlaybackEvent[]
  measures: MeasureStart[]
  onsets: Map<string, MeasureOnset[]>
  /** Printed measure number by ordinal - 1. */
  measureLabels: string[]
  /** Measure xml:id by ordinal - 1. */
  measureIds: string[]
  /** Time signature by ordinal - 1. */
  meters: Meter[]
  /** Written step and octave of every note id. */
  spellings: Map<string, Spelling>
}

export async function loadScore(musicxml: string): Promise<LoadedScore> {
  const tk = await getToolkit()
  tk.setOptions({ breaks: 'auto', adjustPageHeight: true, footer: 'none', header: 'auto' })
  if (!tk.loadData(musicxml)) {
    throw new Error(`Verovio could not read the file: ${tk.getLog() || 'unknown error'}`)
  }
  return describeLoaded(tk)
}

/** Notes, measures and spelling of the score loaded in `tk` (ids are that toolkit's). */
export function describeLoaded(tk: VerovioToolkit): LoadedScore {
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
  const written = assignMeasures(events, measures)
  return {
    events: mergeTies(written, tiesFromMei(mei)),
    writtenEvents: written,
    measures,
    onsets: measureOnsets(timemap),
    measureLabels: measureLabelsFromMei(mei),
    measureIds: measureIdsFromMei(mei),
    meters: metersFromMei(mei),
    spellings: spellingsFromMei(mei)
  }
}

/**
 * A second toolkit for work that must not disturb the score on screen (drill
 * snippets, PDF export): its own loaded data and layout.
 */
export function getAuxToolkit(): Promise<VerovioToolkit> {
  drillToolkitPromise ??= getModule().then((module) => new VerovioToolkit(module))
  return drillToolkitPromise
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
