import { useCallback, useEffect, useRef, useState } from 'react'
import { inTauri, ipc } from '../../lib/ipc'
import { drawAnalysis, systemSpacingFor } from '../../lib/analysisOverlay'
import { followCursor, highlightNotes, markMeasures, markSelected, markWarnings } from '../../lib/overlay'
import { clearLookahead, drawAids, drawLookahead } from '../../lib/practiceOverlay'
import { useView } from '../../stores/view'
import { useCompose } from '../../stores/compose'
import { clearPatterns, drawPatterns } from '../../lib/patterns'
import { renderPages, timeForNote } from '../../lib/verovio'
import { useAnalysis } from '../../stores/analysis'
import { useMidi } from '../../stores/midi'
import { selectNote, useOmr } from '../../stores/omr'
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
  const timedResults = useMidi((s) => s.timedResults)
  const timed = useMidi((s) => s.timed)
  const countingIn = useMidi((s) => s.countingIn)
  const lookahead = useView((s) => s.lookahead)
  const aidNoteNames = useView((s) => s.aidNoteNames)
  const aidIntervals = useView((s) => s.aidIntervals)
  const aidChordShapes = useView((s) => s.aidChordShapes)
  const spellings = useScore((s) => s.spellings)
  const proposal = useCompose((s) => s.preview)
  const measures = useScore((s) => s.measures)
  const onsets = useScore((s) => s.onsets)
  const analysis = useAnalysis((s) => s.analysis)
  const display = useAnalysis((s) => s.display)
  const selectedPattern = useAnalysis((s) => s.selectedPattern)
  const reviewing = useOmr((s) => s.phase === 'review')
  const omrWarnings = useOmr((s) => s.warnings)
  const selectedNote = useOmr((s) => s.selectedId)
  const measureIds = useScore((s) => s.measureIds)
  const events = useScore((s) => s.events)
  const leftHandIds = useRef(new Set<string>())
  useEffect(() => {
    leftHandIds.current = new Set(events.filter((e) => e.staff >= 2).map((e) => e.noteId))
  }, [events])
  const isLeftHand = useCallback((id: string) => leftHandIds.current.has(id), [])
  const [width, setWidth] = useState(0)
  const analysisSpacing = useAnalysis((s) => systemSpacingFor(s.display, s.analysis !== null))
  // Room for the reading aids above and below the staves.
  const spacingSystem = analysisSpacing + (aidNoteNames || aidIntervals || aidChordShapes ? 6 : 0)
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
    highlighted.current = highlightNotes(el, [], currentNoteIds, isLeftHand)
    // Only when the SVG changes; cursor moves are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    highlighted.current = highlightNotes(el, highlighted.current, currentNoteIds, isLeftHand)
    if (playing || following) followCursor(el, currentNoteIds[0])
  }, [currentNoteIds, playing, following, isLeftHand])

  // Harmonic analysis: symbols above, roman numerals below, anchored to (measure, offset).
  useEffect(() => {
    const el = containerRef.current
    if (!el || !analysis) return
    drawAnalysis(el, analysis, onsets, display)
    return () => drawAnalysis(el, { chords: [] }, onsets, display)
  }, [analysis, display, onsets, pages])

  // Repeated phrases: one colour per pattern.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    if (analysis?.patterns?.length && display.patterns) drawPatterns(el, analysis.patterns, selectedPattern)
    else clearPatterns(el)
  }, [analysis, display.patterns, selectedPattern, pages])

  // PDF review: flagged measures and the note selected for correction.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    markWarnings(el, reviewing ? omrWarnings : [], measureIds)
    markSelected(el, reviewing ? selectedNote : null)
  }, [reviewing, omrWarnings, selectedNote, measureIds, pages])

  // Follow-mode results: green measures without mistakes, red with. "A tempo"
  // results: green all on time, yellow some early or late, red wrong or missed notes.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const follow = Object.values(results).flatMap((r) => {
      const m = measures[r.measure - 1]
      if (!m) return []
      const status = r.wrong === 0 ? ('ok' as const) : ('err' as const)
      return [
        { measureId: m.measureId, status, title: `Battuta ${r.measure}: ${r.correct} giuste, ${r.wrong} sbagliate` }
      ]
    })
    const timedMarks = Object.values(timedResults).flatMap((r) => {
      const m = measures[r.measure - 1]
      if (!m) return []
      const status =
        r.wrong + r.missed > 0 ? ('err' as const) : r.early + r.late > 0 ? ('warn' as const) : ('ok' as const)
      const title = `Battuta ${r.measure}: ${r.correct} a tempo, ${r.early} in anticipo, ${r.late} in ritardo, ${r.wrong} sbagliate, ${r.missed} mancate`
      return [{ measureId: m.measureId, status, title }]
    })
    markMeasures(el, [...follow, ...timedMarks])
  }, [results, timedResults, measures, pages])

  // «Componi»: Claude's new measures in violet until kept or dropped.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const marks = proposal ? Array.from({ length: proposal.added }, (_, i) => ({ measure: proposal.first + i })) : []
    markWarnings(el, marks, measureIds, 'compose-new')
  }, [proposal, measureIds, pages])

  // Look-ahead: cover the measure being played (and the next) while the music goes.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const active = lookahead !== 'off' && (playing || following || timed) && !countingIn
    if (active) drawLookahead(el, currentNoteIds[0], lookahead === 'next')
    else clearLookahead(el)
  }, [currentNoteIds, lookahead, playing, following, timed, countingIn, pages])

  // Reading aids, redrawn with the layout.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    drawAids(el, { noteNames: aidNoteNames, intervals: aidIntervals, chordShapes: aidChordShapes }, spellings, events)
  }, [aidNoteNames, aidIntervals, aidChordShapes, spellings, events, pages])

  const onClick = async (e: React.MouseEvent) => {
    const note = (e.target as Element).closest('g.note')
    if (reviewing) {
      selectNote(note?.id ?? null) // correcting: a click selects, it does not seek
      return
    }
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
          <p className="score-empty-title">Trascina qui uno spartito</p>
          <p>.musicxml, .mxl, un PDF, un MIDI o una registrazione — oppure usa File → Apri…</p>
        </div>
      )}
    </div>
  )
}
