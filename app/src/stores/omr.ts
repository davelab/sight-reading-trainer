import { create } from 'zustand'
import { save } from '@tauri-apps/plugin-dialog'
import { inTauri, ipc, onOmrDone, onOmrFailed, onOmrProgress, type EditAction } from '../lib/ipc'
import { openMusicXml } from '../lib/loadScore'
import { findNote } from '../lib/noteRefs'
import type { NoteRef, OmrProgress, OmrWarning } from '../types'
import { runAnalysis } from './analysis'
import { useScore } from './score'

/**
 * PDF import (OMR) and the correction of the recognised score.
 * idle → running (progress) → review (correct, then «Fine») → idle; or error.
 */
export interface OmrState {
  phase: 'idle' | 'running' | 'review' | 'error'
  jobId: string | null
  fileName: string | null
  progress: OmrProgress | null
  error: string | null
  previews: string[]
  warnings: OmrWarning[]
  /** Current recognised MusicXML, and the versions before each correction (undo). */
  musicxml: string | null
  history: string[]
  /** Verovio id of the selected note, and its position. */
  selectedId: string | null
  selected: NoteRef | null
  busy: boolean
}

const initial: Omit<OmrState, never> = {
  phase: 'idle',
  jobId: null,
  fileName: null,
  progress: null,
  error: null,
  previews: [],
  warnings: [],
  musicxml: null,
  history: [],
  selectedId: null,
  selected: null,
  busy: false
}

export const useOmr = create<OmrState>(() => ({ ...initial }))

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path

export async function startPdfImport(path: string): Promise<void> {
  if (!inTauri) {
    useOmr.setState({ ...initial, phase: 'error', error: "L'import da PDF richiede l'app desktop" })
    return
  }
  useOmr.setState({ ...initial, phase: 'running', fileName: baseName(path) })
  try {
    const { jobId } = await ipc.importPdf(path)
    // Progress events may already have arrived for this job: keep them.
    useOmr.setState((s) => ({ jobId, progress: s.progress?.jobId === jobId ? s.progress : null }))
  } catch (e) {
    useOmr.setState({ phase: 'error', error: String(e) })
  }
}

export async function cancelPdfImport(): Promise<void> {
  const { jobId } = useOmr.getState()
  if (jobId) await ipc.omrCancel(jobId)
  else useOmr.setState({ ...initial })
}

function sameJob(jobId: string): boolean {
  const s = useOmr.getState()
  return s.phase === 'running' && (s.jobId === null || s.jobId === jobId)
}

/** Subscribe to omr:* events; returns the unsubscribe function. */
export function listenOmrEvents(): () => void {
  const offs = [
    onOmrProgress((p) => {
      if (sameJob(p.jobId)) useOmr.setState({ progress: p })
    }),
    onOmrDone(async (r) => {
      if (!sameJob(r.jobId)) return
      const { fileName } = useOmr.getState()
      useOmr.setState({
        phase: 'review',
        previews: r.previews,
        warnings: r.warnings,
        musicxml: r.musicxml,
        history: [],
        progress: null
      })
      const title = (fileName ?? 'PDF').replace(/\.pdf$/i, '')
      try {
        await openMusicXml(`${title}.musicxml`, r.musicxml, title, { analyze: false })
      } catch (e) {
        useOmr.setState({ phase: 'error', error: `La partitura riconosciuta non si apre: ${e}` })
      }
    }),
    onOmrFailed((f) => {
      if (!sameJob(f.jobId)) return
      useOmr.setState(f.cancelled ? { ...initial } : { phase: 'error', error: f.message, progress: null })
    })
  ]
  return () => offs.forEach((off) => void off.then((fn) => fn()))
}

export function selectNote(noteId: string | null): void {
  const ref = noteId ? (useScore.getState().noteRefs.get(noteId) ?? null) : null
  useOmr.setState({ selectedId: ref ? noteId : null, selected: ref })
}

async function show(musicxml: string, reselect: NoteRef | null): Promise<void> {
  const title = useScore.getState().title
  await openMusicXml(useScore.getState().fileName ?? 'score.musicxml', musicxml, title, {
    analyze: false,
    keepTransport: true
  })
  const id = reselect ? findNote(useScore.getState().noteRefs, reselect) : null
  selectNote(id)
}

export async function correct(action: EditAction): Promise<void> {
  const s = useOmr.getState()
  if (!s.musicxml || !s.selected || s.busy) return
  useOmr.setState({ busy: true, error: null })
  try {
    const result = await ipc.scoreEdit(s.musicxml, s.selected, action)
    useOmr.setState({ musicxml: result.musicxml, warnings: result.warnings, history: [...s.history, s.musicxml] })
    await show(result.musicxml, action === 'delete' ? null : s.selected)
  } catch (e) {
    useOmr.setState({ error: String(e) })
  } finally {
    useOmr.setState({ busy: false })
  }
}

export async function undoCorrection(): Promise<void> {
  const s = useOmr.getState()
  const previous = s.history.at(-1)
  if (!previous || s.busy) return
  useOmr.setState({ busy: true })
  try {
    const check = await ipc.scoreCheck(previous)
    useOmr.setState({ musicxml: previous, warnings: check.warnings, history: s.history.slice(0, -1) })
    await show(previous, s.selected)
  } finally {
    useOmr.setState({ busy: false })
  }
}

export async function saveRecognised(): Promise<void> {
  const s = useOmr.getState()
  if (!s.musicxml) return
  const path = await save({
    defaultPath: (s.fileName ?? 'score.pdf').replace(/\.pdf$/i, '.musicxml'),
    filters: [{ name: 'MusicXML', extensions: ['musicxml'] }]
  })
  if (path) await ipc.saveTextFile(path, s.musicxml)
}

/** End the review: the corrected score becomes the open score and is analysed. */
export function finishReview(): void {
  const { musicxml } = useOmr.getState()
  useOmr.setState({ ...initial })
  if (musicxml) {
    useScore.getState().set({ musicxml })
    void runAnalysis(musicxml)
  }
}
