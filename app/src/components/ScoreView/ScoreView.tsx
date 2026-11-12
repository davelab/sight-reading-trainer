import { useEffect, useRef, useState } from 'react'
import { inTauri, ipc } from '../../lib/ipc'
import { drawAnalysis, systemSpacingFor } from '../../lib/analysisOverlay'
import { followCursor, highlightNotes, markMeasures } from '../../lib/overlay'
import { renderPages, timeForNote } from '../../lib/verovio'
import { useAnalysis } from '../../stores/analysis'
import { useMidi } from '../../stores/midi'
import { useScore } from '../../stores/score'
import { useTransport } from '../../stores/transport'
import './ScoreView.css'

/** Verovio rendering at window width, with the playback cursor on the notes. */
export function ScoreView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const highlighted = useRef<string[]>([])
  const musicxml = useScore((s) => s.musicxml)
  const zoom = useScore((s) => s.zoom)
  const layout = useScore((s) => s.layout)
  const currentNoteIds = useTransport((s) => s.currentNoteIds)
  const playing = useTransport((s) => s.playing)
  const following = useMidi((s) => s.following)
  const results = useMidi((s) => s.results)
  const measures = useScore((s) => s.measures)
  const onsets = useScore((s) => s.onsets)
  const analysis = useAnalysis((s) => s.analysis)
  const display = useAnalysis((s) => s.display)
  const [width, setWidth] = useState(0)
  const spacingSystem = useAnalysis((s) => systemSpacingFor(s.display, s.analysis !== null))
  const [pages, setPages] = useState<string[]>([])

  // Track the container width, debounced, so the layout follows the window.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver(([entry]) => {
      clearTimeout(timer)
      timer = setTimeout(() => setWidth(Math.floor(entry.contentRect.width)), 120)
    })
    observer.observe(el)
    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!musicxml || width === 0) return
    let cancelled = false
    void renderPages({ widthPx: width - 32, scale: zoom, spacingSystem }).then((svgs) => {
      if (!cancelled) setPages(svgs)
    })
    return () => {
      cancelled = true
    }
  }, [musicxml, width, zoom, spacingSystem])

  // After every render, re-apply the highlight to the fresh SVG.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    highlighted.current = highlightNotes(el, [], currentNoteIds)
    // Only when the SVG changes; cursor moves are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    highlighted.current = highlightNotes(el, highlighted.current, currentNoteIds)
    if (playing || following) followCursor(el, currentNoteIds[0])
  }, [currentNoteIds, playing, following])

  // Harmonic analysis: symbols above, roman numerals below, anchored to (measure, offset).
  useEffect(() => {
    const el = containerRef.current
    if (!el || !analysis) return
    drawAnalysis(el, analysis, onsets, display)
    return () => drawAnalysis(el, { chords: [] }, onsets, display)
  }, [analysis, display, onsets, pages])

  // Follow-mode results: green measures without mistakes, red with.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const marks = Object.values(results).flatMap((r) => {
      const m = measures[r.measure - 1]
      if (!m) return []
      const status = r.wrong === 0 ? ('ok' as const) : ('err' as const)
      return [{ measureId: m.measureId, status, title: `Battuta ${r.measure}: ${r.correct} giuste, ${r.wrong} sbagliate` }]
    })
    markMeasures(el, marks)
  }, [results, measures, pages])

  const onClick = async (e: React.MouseEvent) => {
    const note = (e.target as Element).closest('g.note')
    if (!note || !inTauri) return
    const ms = await timeForNote(note.id)
    if (ms !== null) await ipc.seek(ms)
  }

  return (
    <div ref={containerRef} className={`score-view layout-${layout}`} onClick={onClick}>
      {musicxml ? (
        pages.map((svg, i) => <div key={i} className="score-page" dangerouslySetInnerHTML={{ __html: svg }} />)
      ) : (
        <div className="score-empty">
          <p className="score-empty-title">Trascina qui un file MusicXML</p>
          <p>.musicxml, .xml o .mxl — oppure usa «Apri…»</p>
        </div>
      )}
    </div>
  )
}
