import { create } from 'zustand'
import { ask } from '@tauri-apps/plugin-dialog'
import { inTauri, ipc, type Hands } from '../lib/ipc'
import { closeScore, openMusicXml } from '../lib/loadScore'
import { saveScore } from '../lib/saveScore'
import type { Analysis } from '../types'
import { runAnalysis, useAnalysis } from './analysis'
import { useCompose, type ComposeState } from './compose'
import { resetReview, reviewSnapshot, useOmr, type OmrState } from './omr'
import { useScore } from './score'
import { useTransport } from './transport'

/**
 * Open scores, one tab each. The stores hold the active one; switching tabs
 * keeps what the others need to come back as they were: the score, whether it
 * is saved, its analysis, a correction in progress, Claude's proposals, and
 * where the music was (position, tempo, hands).
 */
export interface Doc {
  id: string
  title: string
  fileName: string
  musicxml: string
  unsaved: boolean
  analysis: Analysis | null
  review: Partial<OmrState> | null
  compose: Pick<ComposeState, 'midi' | 'advice' | 'problems' | 'preview'> | null
  positionMs: number
  tempoPercent: number
  hands: Hands
}

interface DocumentsState {
  docs: Doc[]
  activeId: string | null
  /** A tab switch is loading the score: ignore clicks meanwhile. */
  switching: boolean
  /** A new score is being opened: the stores do not hold the active tab now. */
  opening: boolean
}

export const useDocuments = create<DocumentsState>(() => ({
  docs: [],
  activeId: null,
  switching: false,
  opening: false
}))

let counter = 0
const newId = () => `doc-${Date.now().toString(36)}-${++counter}`

/** The active tab as it is now in the stores. */
function capture(id: string, withReview: boolean, previous: Doc | undefined): Doc {
  const score = useScore.getState()
  const transport = useTransport.getState()
  const compose = useCompose.getState()
  return {
    id,
    title: score.title ?? previous?.title ?? 'Spartito',
    fileName: score.fileName ?? previous?.fileName ?? 'spartito.musicxml',
    musicxml: score.musicxml ?? previous?.musicxml ?? '',
    unsaved: score.unsaved,
    analysis: useAnalysis.getState().analysis,
    review: withReview ? reviewSnapshot() : (previous?.review ?? null),
    compose: { midi: compose.midi, advice: compose.advice, problems: compose.problems, preview: compose.preview },
    positionMs: transport.positionMs,
    tempoPercent: transport.tempoPercent,
    hands: transport.hands
  }
}

/**
 * Save the active tab's state into its record. `withReview`: also a correction
 * in progress (not when a new import is arriving: the review then is the new one's).
 */
export function snapshotActive(withReview: boolean): void {
  const { docs, activeId, opening, switching } = useDocuments.getState()
  if (!activeId || opening || switching || !useScore.getState().musicxml) return
  useDocuments.setState({
    docs: docs.map((d) => (d.id === activeId ? capture(activeId, withReview, d) : d))
  })
}

/** A new score is about to replace the stores' content (the left tab is already saved). */
export function beginOpen(): void {
  useDocuments.setState({ opening: true })
}

/** Opening failed: the stores still hold the active tab. */
export function cancelOpen(): void {
  useDocuments.setState({ opening: false })
}

/** A score just opened in the stores becomes a new tab, the active one. */
export function addOpenedAsTab(): void {
  const id = newId()
  const doc = capture(id, false, undefined)
  doc.review = null
  useDocuments.setState((s) => ({ docs: [...s.docs, doc], activeId: id, opening: false }))
}

/** Keep the active tab's title and saved state in step with the stores (tab bar). */
useScore.subscribe((score, previous) => {
  if (score.title === previous.title && score.unsaved === previous.unsaved && score.fileName === previous.fileName)
    return
  const { activeId, docs, opening, switching } = useDocuments.getState()
  if (!activeId || opening || switching) return
  useDocuments.setState({
    docs: docs.map((d) =>
      d.id === activeId
        ? { ...d, title: score.title ?? d.title, unsaved: score.unsaved, fileName: score.fileName ?? d.fileName }
        : d
    )
  })
})

export async function switchTo(id: string): Promise<void> {
  const { activeId, docs, switching } = useDocuments.getState()
  if (id === activeId || switching) return
  const target = docs.find((d) => d.id === id)
  if (!target) return
  if (useTransport.getState().playing && inTauri) await ipc.pause()
  snapshotActive(true)
  useDocuments.setState({ switching: true, activeId: id })
  try {
    await restore(target)
  } finally {
    useDocuments.setState({ switching: false })
  }
}

async function restore(doc: Doc): Promise<void> {
  await openMusicXml(doc.fileName, doc.musicxml, doc.title, { analyze: false, restore: true })
  useScore.getState().set({ unsaved: doc.unsaved })
  resetReview()
  if (doc.review) useOmr.setState(doc.review)
  if (doc.analysis) useAnalysis.setState({ analysis: doc.analysis, status: 'done', error: null, selectedPattern: null })
  else if (!doc.review) void runAnalysis(doc.musicxml)
  useCompose.setState({ midi: null, advice: [], problems: [], preview: null, ...(doc.compose ?? {}) })
  const transport = useTransport.getState()
  transport.set({ tempoPercent: doc.tempoPercent, hands: doc.hands, positionMs: doc.positionMs })
  if (inTauri) {
    await Promise.all([ipc.setTempo(doc.tempoPercent), ipc.setHands(doc.hands)])
    await ipc.seek(doc.positionMs)
  }
}

/**
 * Close a tab. An unsaved active score is offered for saving; an unsaved tab in
 * the background is closed after asking. `force`: no questions (already asked).
 */
export async function closeTab(id: string, force = false): Promise<void> {
  const { docs, activeId } = useDocuments.getState()
  const doc = docs.find((d) => d.id === id)
  if (!doc) return
  const isActive = id === activeId
  const unsaved = isActive ? useScore.getState().unsaved : doc.unsaved
  if (unsaved && !force && inTauri) {
    if (isActive) {
      const yes = await ask(`«${doc.title}» non è salvato. Salvarlo prima di chiudere?`, {
        title: 'Modifiche non salvate',
        kind: 'warning',
        okLabel: 'Salva',
        cancelLabel: 'Non salvare'
      })
      if (yes && !(await saveScore())) return
    } else {
      const yes = await ask(`«${doc.title}» non è salvato. Chiudere comunque?`, {
        title: 'Modifiche non salvate',
        kind: 'warning',
        okLabel: 'Chiudi senza salvare',
        cancelLabel: 'Annulla'
      })
      if (!yes) return
    }
  }
  const index = docs.findIndex((d) => d.id === id)
  const rest = docs.filter((d) => d.id !== id)
  if (!isActive) {
    useDocuments.setState({ docs: rest })
    return
  }
  useDocuments.setState({ docs: rest, activeId: null })
  const next = rest[Math.min(index, rest.length - 1)]
  if (next) {
    useDocuments.setState({ activeId: next.id, switching: true })
    try {
      await restore(next)
    } finally {
      useDocuments.setState({ switching: false })
    }
  } else {
    resetReview()
    useCompose.setState({ midi: null, advice: [], problems: [], preview: null })
    await closeScore()
  }
}

/** Whether any open score has changes not saved (the active one as it is now). */
export function anyUnsaved(): boolean {
  const { docs, activeId } = useDocuments.getState()
  return useScore.getState().unsaved || docs.some((d) => d.id !== activeId && d.unsaved)
}
