import { useEffect, useRef, useState } from 'react'
import { inTauri, ipc } from '../../lib/ipc'
import { followCursor, highlightNotes } from '../../lib/overlay'
import { renderPages, timeForNote } from '../../lib/verovio'
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
  const [width, setWidth] = useState(0)
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
    void renderPages({ widthPx: width - 32, scale: zoom }).then((svgs) => {
      if (!cancelled) setPages(svgs)
    })
    return () => {
      cancelled = true
    }
  }, [musicxml, width, zoom])

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
    if (playing) followCursor(el, currentNoteIds[0])
  }, [currentNoteIds, playing])

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
