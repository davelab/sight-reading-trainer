/**
 * The open score as a PDF file, laid out for paper (A4 or Letter), with the
 * annotations the user chooses: chord labels (any style, coloured or not) and
 * the reading aids (note names, skips, chord shapes).
 *
 * Verovio lays the score out on a second toolkit (the one on screen keeps its
 * layout); each page's SVG gets the same overlays as the screen, their colours
 * and fonts are written into the SVG, and svg2pdf.js draws it into jsPDF.
 * Text of the overlays uses DejaVu Sans (free licence) for ♯, ♭, ↑, ↓, °.
 */
import type { jsPDF as JsPDF } from 'jspdf'
import dejavuUrl from 'dejavu-fonts-ttf/ttf/DejaVuSans.ttf?url'
import dejavuBoldUrl from 'dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf?url'
import type { Analysis } from '../types'
import { clearAnalysis, drawAnalysis, systemSpacingFor } from './analysisOverlay'
import type { ChordLabelStyle } from './chordLabels'
import { drawAids } from './practiceOverlay'
import { describeLoaded, getAuxToolkit } from './verovio'

export interface PdfOptions {
  paper: 'a4' | 'letter'
  /** Size of the music on the page. */
  size: 'small' | 'normal' | 'large'
  chords: boolean
  labelStyle: ChordLabelStyle
  colours: boolean
  noteNames: boolean
  intervals: boolean
  chordShapes: boolean
}

/** Page sizes: Verovio units (tenths of mm) and PDF points. */
const PAPER = {
  a4: { width: 2100, height: 2970, pt: [595.28, 841.89] },
  letter: { width: 2159, height: 2794, pt: [612, 792] }
} as const
const SCALE = { small: 33, normal: 40, large: 50 } as const
const OVERLAY_FONT = 'DejaVu Sans'
/** Classes of the overlays drawn on Verovio's SVG. */
const OVERLAY = '.analysis-mark, .reading-aid'

let fontCache: { regular: string; bold: string } | null = null

async function base64Of(url: string): Promise<string> {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

async function addFonts(doc: JsPDF): Promise<void> {
  fontCache ??= { regular: await base64Of(dejavuUrl), bold: await base64Of(dejavuBoldUrl) }
  doc.addFileToVFS('DejaVuSans.ttf', fontCache.regular)
  doc.addFont('DejaVuSans.ttf', OVERLAY_FONT, 'normal')
  doc.addFileToVFS('DejaVuSans-Bold.ttf', fontCache.bold)
  doc.addFont('DejaVuSans-Bold.ttf', OVERLAY_FONT, 'bold')
}

/** SMuFL metronome glyphs Verovio writes in tempo marks (font Leipzig, not in the PDF). */
const SMUFL_TEXT: Record<string, string> = {
  // SMuFL "metronome marks" (metNote*), as Verovio writes them.
  '\uECA2': '𝅝',
  '\uECA3': '𝅗𝅥',
  '\uECA4': '𝅗𝅥',
  '\uECA5': '♩',
  '\uECA6': '♩',
  '\uECA7': '♪',
  '\uECA8': '♪',
  '\uECB7': '.',
  // Individual notes, in case a mark uses them.
  '\uE1D2': '𝅝',
  '\uE1D3': '𝅗𝅥',
  '\uE1D5': '♩',
  '\uE1D7': '♪',
  '\uE1E7': '.'
}

/** Tempo marks: SMuFL glyphs as ordinary note signs in the embedded font. */
function replaceSmuflText(svg: SVGSVGElement): void {
  for (const span of svg.querySelectorAll<SVGTSpanElement>('tspan[font-family="Leipzig"]')) {
    const text = [...(span.textContent ?? '')]
      .map((ch) => SMUFL_TEXT[ch] ?? (/[\uE000-\uF8FF]/.test(ch) ? '' : ch))
      .join('')
    span.textContent = text
    span.setAttribute('font-family', OVERLAY_FONT)
    const size = parseFloat(span.getAttribute('font-size') ?? '0')
    if (size) span.setAttribute('font-size', `${Math.round(size * 0.75)}px`)
  }
}

/**
 * svg2pdf does not see the app's stylesheets: copy what they give the overlays
 * (colour, weight, style) into attributes, and use the embedded font.
 */
function inlineOverlayStyles(svg: SVGSVGElement): void {
  for (const el of svg.querySelectorAll<SVGElement>(OVERLAY)) {
    const cs = getComputedStyle(el)
    el.setAttribute('fill', cs.fill)
    if (cs.fillOpacity !== '1') el.setAttribute('fill-opacity', cs.fillOpacity)
    if (el.tagName === 'text') {
      el.setAttribute('font-family', OVERLAY_FONT)
      el.setAttribute('font-weight', Number(cs.fontWeight) >= 600 ? 'bold' : 'normal')
      el.setAttribute('font-style', 'normal')
    }
    el.removeAttribute('class')
  }
}

export interface RenderedPages {
  pages: SVGSVGElement[]
  /** Removes the hidden host the pages were drawn in. */
  dispose: () => void
}

/** Lay the score out on paper and draw the chosen overlays (pages stay in the DOM, hidden). */
export async function renderForPrint(
  musicxml: string,
  analysis: Analysis | null,
  o: PdfOptions,
  onlyFirst = false
): Promise<RenderedPages> {
  const tk = await getAuxToolkit()
  const paper = PAPER[o.paper]
  const aids = o.noteNames || o.intervals || o.chordShapes
  const spacing =
    systemSpacingFor({ chords: o.chords, labelStyle: o.labelStyle, functions: o.colours }, !!analysis) + (aids ? 6 : 0)
  tk.setOptions({
    pageWidth: paper.width,
    pageHeight: paper.height,
    scale: SCALE[o.size],
    adjustPageHeight: false,
    breaks: 'auto',
    header: 'auto',
    footer: 'none',
    spacingSystem: spacing,
    pageMarginTop: 120,
    pageMarginBottom: 120,
    pageMarginLeft: 110,
    pageMarginRight: 110
  })
  if (!tk.loadData(musicxml)) throw new Error('lo spartito non si può impaginare')
  const loaded = describeLoaded(tk)
  // Hidden but laid out: the overlays measure the notes (getBBox). The class
  // gives them the screen's colours.
  const host = document.createElement('div')
  host.className = 'score-view print-host'
  host.style.cssText = 'position:fixed;left:-20000px;top:0;width:1200px;visibility:hidden;pointer-events:none'
  document.body.appendChild(host)
  const count = onlyFirst ? 1 : tk.getPageCount()
  const pages: SVGSVGElement[] = []
  for (let p = 1; p <= count; p++) {
    const wrap = document.createElement('div')
    wrap.innerHTML = tk.renderToSVG(p)
    host.appendChild(wrap)
    const svg = wrap.querySelector('svg')
    if (!svg) continue
    clearAnalysis(wrap)
    if (analysis && o.chords) {
      drawAnalysis(wrap, analysis, loaded.onsets, { chords: true, labelStyle: o.labelStyle, functions: o.colours })
    }
    drawAids(
      wrap,
      { noteNames: o.noteNames, intervals: o.intervals, chordShapes: o.chordShapes },
      loaded.spellings,
      loaded.events
    )
    pages.push(svg)
  }
  return { pages, dispose: () => host.remove() }
}

/** The PDF file's bytes. */
export async function buildPdf(
  musicxml: string,
  analysis: Analysis | null,
  o: PdfOptions,
  title: string
): Promise<Uint8Array> {
  const [{ jsPDF }] = await Promise.all([import('jspdf'), import('svg2pdf.js')])
  const paper = PAPER[o.paper]
  const doc = new jsPDF({ unit: 'pt', format: [paper.pt[0], paper.pt[1]], orientation: 'portrait', compress: true })
  doc.setProperties({ title, creator: 'Score Studio' })
  await addFonts(doc)
  const { pages, dispose } = await renderForPrint(musicxml, analysis, o)
  try {
    for (let i = 0; i < pages.length; i++) {
      if (i > 0) doc.addPage([paper.pt[0], paper.pt[1]], 'portrait')
      inlineOverlayStyles(pages[i])
      replaceSmuflText(pages[i])
      await doc.svg(pages[i], { x: 0, y: 0, width: paper.pt[0], height: paper.pt[1] })
      if (pages.length > 1) {
        doc.setFont(OVERLAY_FONT, 'normal')
        doc.setFontSize(9)
        doc.setTextColor(120)
        doc.text(`${i + 1} / ${pages.length}`, paper.pt[0] / 2, paper.pt[1] - 24, { align: 'center' })
      }
    }
  } finally {
    dispose()
  }
  return new Uint8Array(doc.output('arraybuffer'))
}
