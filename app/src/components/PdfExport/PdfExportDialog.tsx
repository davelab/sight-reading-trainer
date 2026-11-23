import { useEffect, useRef, useState } from 'react'
import { save } from '@tauri-apps/plugin-dialog'
import { LABEL_STYLES, type ChordLabelStyle } from '../../lib/chordLabels'
import { inTauri, ipc } from '../../lib/ipc'
import { buildPdf, renderForPrint, type PdfOptions } from '../../lib/pdfExport'
import { useAnalysis } from '../../stores/analysis'
import { useScore } from '../../stores/score'
import { useView } from '../../stores/view'
import { create } from 'zustand'
import '../TranscribeSetup/TranscribeSetup.css'
import './PdfExportDialog.css'

/** Whether the «Esporta PDF» dialog is open. */
export const usePdfDialog = create<{ open: boolean }>(() => ({ open: false }))

function initialOptions(): PdfOptions {
  const display = useAnalysis.getState().display
  const view = useView.getState()
  return {
    paper: 'a4',
    size: 'normal',
    chords: display.chords && !!useAnalysis.getState().analysis,
    labelStyle: display.labelStyle,
    colours: display.functions,
    noteNames: view.aidNoteNames,
    intervals: view.aidIntervals,
    chordShapes: view.aidChordShapes
  }
}

/** Export the open score as a PDF, with or without chord labels and reading aids. */
export function PdfExportDialog() {
  const open = usePdfDialog((s) => s.open)
  const musicxml = useScore((s) => s.musicxml)
  const title = useScore((s) => s.title)
  const analysis = useAnalysis((s) => s.analysis)
  const [o, setO] = useState<PdfOptions>(initialOptions)
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0)

  useEffect(() => {
    if (!open) return
    setO(initialOptions())
    setError(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') usePdfDialog.setState({ open: false })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // First page as it will print, redrawn when an option changes.
  useEffect(() => {
    if (!open || !musicxml) return
    const mine = ++request.current
    const timer = setTimeout(async () => {
      try {
        const { pages, dispose } = await renderForPrint(musicxml, analysis, o, true)
        if (mine === request.current) setPreview(pages[0]?.outerHTML ?? '')
        dispose()
      } catch (e) {
        if (mine === request.current) setError(String(e))
      }
    }, 150)
    return () => clearTimeout(timer)
  }, [open, musicxml, analysis, o])

  if (!open) return null
  const set = (patch: Partial<PdfOptions>) => setO((x) => ({ ...x, ...patch }))
  const close = () => usePdfDialog.setState({ open: false })
  const name = `${(title ?? 'spartito').replace(/[\\/:*?"<>|]/g, '-')}.pdf`

  const exportPdf = async () => {
    if (!musicxml) return
    setBusy(true)
    setError(null)
    try {
      const bytes = await buildPdf(musicxml, analysis, o, title ?? 'Spartito')
      if (inTauri) {
        const path = await save({ defaultPath: name, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
        if (!path) return
        await ipc.saveBinaryFile(path, bytes)
      } else {
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
        const a = document.createElement('a')
        a.href = url
        a.download = name
        a.click()
        URL.revokeObjectURL(url)
      }
      close()
    } catch (e) {
      setError(`Esportazione non riuscita: ${e}`)
    } finally {
      setBusy(false)
    }
  }

  const check = (key: keyof PdfOptions, label: string, disabled = false) => (
    <label className="pdf-check">
      <input
        type="checkbox"
        checked={o[key] as boolean}
        disabled={disabled}
        onChange={(e) => set({ [key]: e.target.checked })}
      />
      {label}
    </label>
  )

  return (
    <div className="tx-backdrop">
      <div className="tx-setup pdf-dialog" role="dialog" aria-labelledby="pdf-title">
        <h2 id="pdf-title">Esporta PDF</h2>
        <div className="pdf-body">
          <div className="pdf-options">
            <label className="pdf-row">
              <span>Carta</span>
              <select value={o.paper} onChange={(e) => set({ paper: e.target.value as PdfOptions['paper'] })}>
                <option value="a4">A4</option>
                <option value="letter">Lettera (USA)</option>
              </select>
            </label>
            <label className="pdf-row">
              <span>Dimensione</span>
              <select value={o.size} onChange={(e) => set({ size: e.target.value as PdfOptions['size'] })}>
                <option value="small">Piccola (più battute per pagina)</option>
                <option value="normal">Normale</option>
                <option value="large">Grande (più leggibile)</option>
              </select>
            </label>
            <h4>Accordi</h4>
            {check(
              'chords',
              analysis ? 'Scrivi gli accordi' : 'Scrivi gli accordi (analisi non disponibile)',
              !analysis
            )}
            <select
              value={o.labelStyle}
              disabled={!o.chords}
              onChange={(e) => set({ labelStyle: e.target.value as ChordLabelStyle })}
              aria-label="Come scrivere gli accordi"
            >
              {LABEL_STYLES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            {check('colours', 'Colori per funzione', !o.chords)}
            <h4>Aiuti alla lettura</h4>
            {check('noteNames', 'Nomi delle note')}
            {check('intervals', 'Intervalli (salti dalla 3ª)')}
            {check('chordShapes', 'Forme degli accordi')}
            <span className="pdf-presets">
              <button onClick={() => set({ chords: false, noteNames: false, intervals: false, chordShapes: false })}>
                Solo spartito
              </button>
              <button onClick={() => set({ chords: !!analysis, noteNames: true, intervals: true, chordShapes: true })}>
                Con tutti gli aiuti
              </button>
            </span>
          </div>
          <div
            className="pdf-preview"
            aria-label="Anteprima della prima pagina"
            dangerouslySetInnerHTML={{ __html: preview }}
          />
        </div>
        {error && <small className="omr-error">{error}</small>}
        <div className="tx-actions">
          <button onClick={close}>Annulla</button>
          <button className="primary" disabled={busy || !musicxml} onClick={() => void exportPdf()}>
            {busy ? 'Preparo il PDF…' : 'Esporta PDF…'}
          </button>
        </div>
      </div>
    </div>
  )
}
