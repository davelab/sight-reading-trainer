/**
 * «Isola il pianoforte»: a song in, the piano alone and the song without it out.
 * The separation runs in the omr sidecar (open-weight ONNX models); it can take
 * minutes, so the dialog can be hidden while the job goes on.
 */
import { create } from 'zustand'
import { ipc, onSeparateDone, onSeparateFailed, onSeparateProgress } from '../lib/ipc'
import type { SeparateProgress, SeparateResult, SeparationModelInfo } from '../types'

export type SeparationModelId = SeparationModelInfo['id']

interface SeparateState {
  open: boolean
  models: SeparationModelInfo[]
  model: SeparationModelId
  path: string | null
  outDir: string | null
  jobId: string | null
  progress: SeparateProgress | null
  result: SeparateResult | null
  error: string | null
}

const MODEL_KEY = 'separate-model'

function savedModel(): SeparationModelId {
  try {
    return localStorage.getItem(MODEL_KEY) === 'quality' ? 'quality' : 'fast'
  } catch {
    return 'fast'
  }
}

export const useSeparate = create<SeparateState>(() => ({
  open: false,
  models: [],
  model: savedModel(),
  path: null,
  outDir: null,
  jobId: null,
  progress: null,
  result: null,
  error: null
}))

export function folderOf(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i > 0 ? path.slice(0, i) : path
}

export function fileName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}

export async function openSeparate(): Promise<void> {
  useSeparate.setState({ open: true })
  if (useSeparate.getState().jobId) return // a job is running: just show it
  useSeparate.setState({ error: null, result: null, progress: null })
  await refreshModels()
}

export async function refreshModels(): Promise<void> {
  try {
    useSeparate.setState({ models: (await ipc.separateModels()).models })
  } catch (e) {
    useSeparate.setState({ error: String(e) })
  }
}

export function chooseModel(model: SeparationModelId): void {
  useSeparate.setState({ model })
  try {
    localStorage.setItem(MODEL_KEY, model)
  } catch {
    // storage unavailable
  }
}

export function chooseSong(path: string): void {
  useSeparate.setState({ path, outDir: folderOf(path), result: null, error: null, progress: null })
}

export async function startSeparation(): Promise<void> {
  const { path, outDir, model, jobId } = useSeparate.getState()
  if (!path || !outDir || jobId) return
  useSeparate.setState({ error: null, result: null, progress: null })
  try {
    const job = await ipc.separateAudio(path, model, outDir)
    useSeparate.setState({ jobId: job.jobId })
  } catch (e) {
    useSeparate.setState({ error: String(e) })
  }
}

export async function cancelSeparation(): Promise<void> {
  const { jobId } = useSeparate.getState()
  if (jobId) await ipc.separateCancel(jobId)
}

/** Progress as one number 0..1 across the stages (the download only the first time). */
export function overallProgress(p: SeparateProgress | null): number {
  if (!p) return 0
  switch (p.stage) {
    case 'download':
      return p.fraction
    case 'load':
      return 0
    case 'separate':
      return p.fraction * 0.98
    case 'write':
      return 0.98 + p.fraction * 0.02
  }
}

export function listenSeparateEvents(): () => void {
  const mine = (id: string) => id === useSeparate.getState().jobId
  const unlisten = [
    onSeparateProgress((p) => {
      if (mine(p.jobId)) useSeparate.setState({ progress: p })
    }),
    onSeparateDone((r) => {
      if (!mine(r.jobId)) return
      useSeparate.setState({ jobId: null, progress: null, result: r, open: true })
      void refreshModels()
    }),
    onSeparateFailed((f) => {
      if (!mine(f.jobId)) return
      useSeparate.setState({ jobId: null, progress: null, error: f.cancelled ? null : f.message })
      void refreshModels()
    })
  ]
  return () => unlisten.forEach((u) => void u.then((f) => f()))
}
