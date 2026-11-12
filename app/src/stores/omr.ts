import { create } from 'zustand'
import { save } from '@tauri-apps/plugin-dialog'
import {
  inTauri,
  ipc,
  onOmrDone,
  onOmrFailed,
  onOmrProgress,
  onTranscribeDone,
  onTranscribeFailed,
  onTranscribeProgress,
  type EditAction,
  type NoteValue
} from '../lib/ipc'
import { openMusicXml } from '../lib/loadScore'
import { findNote } from '../lib/noteRefs'
import type {
  NoteRef,
  OmrProgress,
  OmrWarning,
  RefineResult,
  TranscribeFacts,
  TranscribeHints,
  TranscribeProgress
} from '../types'
import { runAnalysis } from './analysis'
import { useScore } from './score'

/**
 * PDF import (OMR) or audio transcription, and the correction of the resulting score.
 * idle → [setup: what the user knows, audio only] → running (progress) →
 * review (correct, then «Fine») → idle; or error.
 */
export interface OmrState {
  phase: 'idle' | 'setup' | 'running' | 'review' | 'error'
  /** Audio file waiting for the user's hints (phase 'setup'). */
  pendingPath: string | null
  /** The imported PDF (for Claude's second reading). */
  pdfPath: string | null
  /** Claude is reading measures again; what came of the last reading. */
  refining: boolean
  refineReport: string | null
  /** The «Claude API key» dialog is open. */
  keyDialog: boolean
  /** Where the score comes from: a PDF (OMR) or a recording (transcription). */
  source: 'pdf' | 'audio'
  jobId: string | null
  fileName: string | null
  progress: OmrProgress | null
  transcribeProgress: TranscribeProgress | null
  /** Transcription only: the performance as MIDI (base64) and what was inferred. */
  midi: string | null
  facts: TranscribeFacts | null
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
  pendingPath: null,
  pdfPath: null,
  refining: false,
  refineReport: null,
  keyDialog: false,
  source: 'pdf',
  jobId: null,
  fileName: null,
  progress: null,
  transcribeProgress: null,
  midi: null,
  facts: null,
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
  useOmr.setState({ ...initial, phase: 'running', fileName: baseName(path), pdfPath: path })
  try {
    const { jobId } = await ipc.importPdf(path)
    // Progress events may already have arrived for this job: keep them.
    useOmr.setState((s) => ({ jobId, progress: s.progress?.jobId === jobId ? s.progress : null }))
  } catch (e) {
    useOmr.setState({ phase: 'error', error: String(e) })
  }
}

export async function startAudioTranscription(path: string): Promise<void> {
  if (!inTauri) {
    useOmr.setState({ ...initial, source: 'audio', phase: 'error', error: "La trascrizione richiede l'app desktop" })
    return
  }
  // First ask what the user already knows about the piece (TranscribeSetup).
  useOmr.setState({ ...initial, source: 'audio', phase: 'setup', pendingPath: path, fileName: baseName(path) })
}

/** Start the transcription of the pending file, with the user's hints. */
export async function runTranscription(hints: TranscribeHints): Promise<void> {
  const { pendingPath: path, phase } = useOmr.getState()
  if (!path || phase !== 'setup') return
  useOmr.setState({ phase: 'running', pendingPath: null })
  try {
    const { jobId } = await ipc.transcribeAudio(path, hints)
    useOmr.setState((s) => ({
      jobId,
      transcribeProgress: s.transcribeProgress?.jobId === jobId ? s.transcribeProgress : null
    }))
  } catch (e) {
    useOmr.setState({ phase: 'error', error: String(e) })
  }
}

/** Cancel the running PDF import or transcription. */
export async function cancelImport(): Promise<void> {
  const { jobId, source, phase } = useOmr.getState()
  if (!jobId || phase === 'setup') useOmr.setState({ ...initial })
  else if (source === 'audio') await ipc.transcribeCancel(jobId)
  else await ipc.omrCancel(jobId)
}

/** File name without its extension. */
export const stem = (name: string) => name.replace(/\.[^.]+$/, '')

function sameJob(jobId: string, source: OmrState['source'] = 'pdf'): boolean {
  const s = useOmr.getState()
  return s.phase === 'running' && s.source === source && (s.jobId === null || s.jobId === jobId)
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
      const title = stem(fileName ?? 'PDF')
      try {
        await openMusicXml(`${title}.musicxml`, r.musicxml, title, { analyze: false })
      } catch (e) {
        useOmr.setState({ phase: 'error', error: `La partitura riconosciuta non si apre: ${e}` })
      }
    }),
    onOmrFailed((f) => {
      if (!sameJob(f.jobId)) return
      useOmr.setState(f.cancelled ? { ...initial } : { phase: 'error', error: f.message, progress: null })
    }),
    onTranscribeProgress((p) => {
      if (sameJob(p.jobId, 'audio')) useOmr.setState({ transcribeProgress: p })
    }),
    onTranscribeDone(async (r) => {
      if (!sameJob(r.jobId, 'audio')) return
      const title = stem(useOmr.getState().fileName ?? 'Trascrizione')
      useOmr.setState({
        phase: 'review',
        previews: [],
        warnings: r.warnings,
        musicxml: r.musicxml,
        midi: r.midi,
        facts: r.facts,
        history: [],
        transcribeProgress: null
      })
      try {
        await openMusicXml(`${title}.musicxml`, r.musicxml, title, { analyze: false })
      } catch (e) {
        useOmr.setState({ phase: 'error', error: `La trascrizione non si apre: ${e}` })
      }
    }),
    onTranscribeFailed((f) => {
      if (!sameJob(f.jobId, 'audio')) return
      useOmr.setState(f.cancelled ? { ...initial } : { phase: 'error', error: f.message, transcribeProgress: null })
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

export async function correct(action: EditAction, value?: NoteValue): Promise<void> {
  const s = useOmr.getState()
  if (!s.musicxml || !s.selected || s.busy) return
  useOmr.setState({ busy: true, error: null })
  try {
    const result = await ipc.scoreEdit(s.musicxml, s.selected, action, value)
    useOmr.setState({ musicxml: result.musicxml, warnings: result.warnings, history: [...s.history, s.musicxml] })
    // The engine tells where the edited (or inserted) note is now.
    await show(result.musicxml, result.note ?? null)
  } catch (e) {
    useOmr.setState({ error: String(e) })
  } finally {
    useOmr.setState({ busy: false })
  }
}

/** Italian list: "6", "6 e 8", "6, 7 e 8". */
export function listMeasures(ms: number[]): string {
  return ms.length < 2 ? ms.join('') : `${ms.slice(0, -1).join(', ')} e ${ms[ms.length - 1]}`
}

/** What a second reading did, in one sentence. */
export function refineSummary(r: RefineResult): string {
  const parts: string[] = []
  if (r.changed.length) {
    parts.push(`Claude ha riscritto ${r.changed.length > 1 ? 'le battute' : 'la battuta'} ${listMeasures(r.changed)}.`)
  }
  if (r.kept.length) {
    const why = r.kept.map((k) => `${k.measure} (${k.reason})`).join('; ')
    parts.push(`${r.kept.length > 1 ? 'Rimaste' : 'Rimasta'} com'era: ${why}.`)
  }
  return parts.join(' ') || 'Nessuna battuta sospetta da rileggere: seleziona una nota della battuta da far rileggere.'
}

/**
 * Claude reads the suspicious measures again from the PDF, plus the measure of the
 * selected note. Asks for the API key first if there is none.
 */
export async function refineWithClaude(): Promise<void> {
  const s = useOmr.getState()
  if (!s.musicxml || !s.pdfPath || s.busy || s.refining) return
  if (!(await ipc.apiKeyStatus())) {
    useOmr.setState({ keyDialog: true })
    return
  }
  useOmr.setState({ refining: true, refineReport: null, error: null })
  try {
    const extra = s.selected ? [s.selected.measure] : []
    const result = await ipc.omrRefine(s.pdfPath, s.musicxml, extra)
    if (result.changed.length) {
      useOmr.setState({ musicxml: result.musicxml, warnings: result.warnings, history: [...s.history, s.musicxml] })
      await show(result.musicxml, null)
    }
    useOmr.setState({ refineReport: refineSummary(result) })
  } catch (e) {
    useOmr.setState({ error: String(e) })
  } finally {
    useOmr.setState({ refining: false })
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
    defaultPath: `${stem(s.fileName ?? 'score')}.musicxml`,
    filters: [{ name: 'MusicXML', extensions: ['musicxml'] }]
  })
  if (path) await ipc.saveTextFile(path, s.musicxml)
}

/** Transcription: save the performance as played (timing and pedal) as a MIDI file. */
export async function savePerformanceMidi(): Promise<void> {
  const s = useOmr.getState()
  if (!s.midi) return
  const path = await save({
    defaultPath: `${stem(s.fileName ?? 'esecuzione')}.mid`,
    filters: [{ name: 'MIDI', extensions: ['mid', 'midi'] }]
  })
  if (path)
    await ipc.saveBinaryFile(
      path,
      Uint8Array.from(atob(s.midi), (c) => c.charCodeAt(0))
    )
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
