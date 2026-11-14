import { useEffect, useRef } from 'react'
import { chordLabel } from '../../lib/chordLabels'
import { chordTimes, lighten, visibleEvents, type TimedLabel } from '../../lib/fallingNotes'
import { KEYS, keyAt, noteLabel } from '../../lib/keyboardLayout'
import { useAnalysis } from '../../stores/analysis'
import { useScore } from '../../stores/score'
import { useTransport } from '../../stores/transport'
import { useView } from '../../stores/view'
import './FallingNotes.css'

/** Past notes stay visible this long below the keyboard edge (they slide under it). */
const PAST_MS = 150

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/**
 * Notes falling onto the keyboard (piano-roll view), drawn on a canvas.
 * Rust sends the position ~60 times a second; between two updates the
 * position is extrapolated at the current tempo, so the motion is smooth.
 */
export function FallingNotes() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const anchor = useRef({ ms: 0, at: performance.now(), playing: false })
  const chordsRef = useRef<TimedLabel[]>([])
  const measureLines = useRef<number[]>([])

  // Remember when each position update arrived.
  useEffect(
    () =>
      useTransport.subscribe((s) => {
        anchor.current = { ms: s.positionMs, at: performance.now(), playing: s.playing }
      }),
    []
  )

  // Chord labels and measure lines, recomputed when the score or analysis changes.
  useEffect(() => {
    const update = () => {
      const score = useScore.getState()
      const { analysis, display } = useAnalysis.getState()
      chordsRef.current = chordTimes(
        analysis?.chords ?? [],
        score.measureIds,
        score.measures,
        score.onsets,
        score.events,
        (c) => chordLabel(c, display.labelStyle)
      )
      measureLines.current = [...new Set(score.measures.map((m) => m.ms))]
    }
    update()
    const off1 = useScore.subscribe(update)
    const off2 = useAnalysis.subscribe(update)
    return () => {
      off1()
      off2()
    }
  }, [])

  useEffect(() => {
    let frame = 0
    const draw = () => {
      frame = requestAnimationFrame(draw)
      const canvas = canvasRef.current
      if (!canvas) return
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const view = useView.getState()
      const { events } = useScore.getState()
      const { tempoPercent, currentNoteIds } = useTransport.getState()
      const a = anchor.current
      const pos = a.playing ? a.ms + Math.min(100, performance.now() - a.at) * (tempoPercent / 100) : a.ms
      const pps = view.pixelsPerSecond
      const windowMs = (h / pps) * 1000
      const y = (ms: number) => h - ((ms - pos) / 1000) * pps

      const colors = {
        bg: cssVar('--falling-bg', '#f4f1ea'),
        line: cssVar('--falling-line', 'rgba(0,0,0,0.08)'),
        text: cssVar('--text-secondary', '#666'),
        fn: {
          tonic: cssVar('--fn-tonic', '#1f5fbf'),
          predominant: cssVar('--fn-predominant', '#2a8a3e'),
          dominant: cssVar('--fn-dominant', '#c2410c'),
          other: ''
        } as Record<string, string>
      }
      ctx.fillStyle = colors.bg
      ctx.fillRect(0, 0, w, h)

      // Octave guides (each C) and measure lines.
      if (view.showNoteLines) {
        ctx.strokeStyle = colors.line
        ctx.lineWidth = 1
        for (const k of KEYS) {
          if (k.pitch % 12 !== 0) continue
          const x = Math.round(k.left * w) + 0.5
          ctx.beginPath()
          ctx.moveTo(x, 0)
          ctx.lineTo(x, h)
          ctx.stroke()
        }
        for (const ms of measureLines.current) {
          if (ms < pos || ms > pos + windowMs) continue
          const yy = Math.round(y(ms)) + 0.5
          ctx.beginPath()
          ctx.moveTo(0, yy)
          ctx.lineTo(w, yy)
          ctx.stroke()
        }
      }

      // Chord symbols on the left, at the time they start.
      if (view.showChords) {
        ctx.font = '600 15px -apple-system, system-ui, sans-serif'
        ctx.textBaseline = 'bottom'
        const coloured = useAnalysis.getState().display.functions
        for (const c of chordsRef.current) {
          if (c.ms < pos - 50 || c.ms > pos + windowMs) continue
          ctx.fillStyle = (coloured && colors.fn[c.fn]) || colors.text
          ctx.fillText(c.label, 10, y(c.ms) - 2)
        }
      }

      const sounding = new Set(currentNoteIds)
      const maxDur = events.reduce((m, e) => Math.max(m, e.durMs), 0)
      for (const e of visibleEvents(events, pos - PAST_MS, pos + windowMs, maxDur)) {
        const right = e.staff < 2
        if ((right && !view.showRight) || (!right && !view.showLeft)) continue
        const pitch = e.pitch + view.transpose
        const key = keyAt(pitch)
        if (!key) continue
        const pad = key.white ? 2 : 1
        const x = key.left * w + pad
        const bw = Math.max(2, key.width * w - pad * 2)
        const yb = y(e.onsetMs)
        const yt = y(e.onsetMs + e.durMs)
        const bh = Math.max(4, yb - yt - 2)
        const base = right ? view.rightColor : view.leftColor
        const active = sounding.has(e.noteId) || (e.onsetMs <= pos && pos < e.onsetMs + e.durMs)
        ctx.fillStyle = active ? lighten(base, 0.35) : base
        if (active) {
          ctx.shadowColor = base
          ctx.shadowBlur = 12
        }
        ctx.beginPath()
        if (ctx.roundRect) ctx.roundRect(x, yt + 1, bw, bh, Math.min(6, bw / 2))
        else ctx.rect(x, yt + 1, bw, bh) // Safari < 16 (macOS Catalina)
        ctx.fill()
        ctx.shadowBlur = 0
        if (view.showNoteNames && bh > 14 && bw > 11) {
          ctx.fillStyle = 'rgba(255,255,255,0.95)'
          ctx.font = `600 ${Math.min(11, bw * 0.55)}px -apple-system, system-ui, sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'bottom'
          ctx.fillText(noteLabel(pitch), x + bw / 2, yb - 3)
          ctx.textAlign = 'start'
        }
      }
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [])

  return <canvas ref={canvasRef} className="falling-notes" aria-label="Note cadenti" />
}
