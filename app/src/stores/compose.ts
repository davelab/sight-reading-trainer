import { create } from 'zustand'
import { save } from '@tauri-apps/plugin-dialog'
import { inTauri, ipc, type Recording } from '../lib/ipc'
import { ask } from '@tauri-apps/plugin-dialog'
import { closeScore, openMusicXml } from '../lib/loadScore'
import { useOmr } from './omr'
import { useScore } from './score'
import { useTransport } from './transport'

/** Settings of the recorder, remembered (localStorage). */
export interface ComposeSettings {
  metronome: boolean
  bpm: number
  beatsPerMeasure: number
  countIn: boolean
  measures: number
}

const SETTINGS_KEY = 'compose-settings'
const DEFAULTS: ComposeSettings = { metronome: true, bpm: 80, beatsPerMeasure: 4, countIn: true, measures: 4 }

function loadSettings(): ComposeSettings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') ?? {}) }
  } catch {
    return { ...DEFAULTS }
  }
}

export interface ComposeState {
  settings: ComposeSettings
  phase: 'idle' | 'counting' | 'recording' | 'transcribing'
  /** When the music started (performance.now), for the clock on screen. */
  startedAt: number
  error: string | null
  /** The performance of the last recording as MIDI (base64). */
  midi: string | null
  /** Claude: request in progress, its advice, and new measures awaiting a decision. */
  asking: boolean
  advice: string[]
  problems: string[]
  preview: { before: string; first: number; added: number } | null
  setSettings: (patch: Partial<ComposeSettings>) => void
}

export const useCompose = create<ComposeState>((set) => ({
  settings: loadSettings(),
  phase: 'idle',
  startedAt: 0,
  error: null,
  midi: null,
  asking: false,
  advice: [],
  problems: [],
  preview: null,
  setSettings: (patch) =>
    set((s) => {
      const settings = { ...s.settings, ...patch }
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
      } catch {
        // storage unavailable: lasts for this session
      }
      return { settings }
    })
}))

export async function startRecording(): Promise<void> {
  if (!inTauri) return
  const { settings } = useCompose.getState()
  useTransport.getState().set({ playing: false })
  const lead = await ipc.recordStart(
    settings.metronome ? settings.bpm : null,
    settings.beatsPerMeasure,
    settings.metronome && settings.countIn
  )
  useCompose.setState({
    phase: lead > 0 ? 'counting' : 'recording',
    startedAt: performance.now() + lead,
    error: null,
    advice: [],
    problems: [],
    preview: null
  })
  if (lead > 0) {
    setTimeout(() => {
      if (useCompose.getState().phase === 'counting') useCompose.setState({ phase: 'recording' })
    }, lead)
  }
}

/** Stop without keeping anything (a false start). */
export async function cancelRecording(): Promise<void> {
  await ipc.recordStop()
  useCompose.setState({ phase: 'idle', error: null })
}

/** Throw the idea away (after asking) to start again from an empty page. */
export async function discardIdea(): Promise<void> {
  const unsaved = useScore.getState().unsaved
  if (unsaved && inTauri) {
    const yes = await ask('Cancellare questa idea? Lo spartito non salvato andrà perso.', {
      title: 'Cancella idea',
      kind: 'warning',
      okLabel: 'Cancella',
      cancelLabel: 'Annulla'
    })
    if (!yes) return
  }
  await closeScore()
  useCompose.setState({ midi: null, advice: [], problems: [], preview: null, error: null })
}

/** Stop, and turn the recording into a score (it becomes the open score). */
export async function stopRecording(): Promise<void> {
  const recording: Recording | null = await ipc.recordStop()
  if (!recording || recording.notes.length === 0) {
    useCompose.setState({ phase: 'idle', error: 'Nessuna nota registrata: suona qualcosa dopo il conteggio.' })
    return
  }
  useCompose.setState({ phase: 'transcribing' })
  const now = new Date()
  const title = `Idea del ${now.toLocaleDateString('it-IT')} ${now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`
  try {
    const result = await ipc.composeTranscribe(recording, title)
    await openMusicXml(`${title.replace(/[/:]/g, '-')}.musicxml`, result.musicxml, title)
    useScore.getState().set({ unsaved: true })
    useCompose.setState({ phase: 'idle', midi: result.midi })
  } catch (e) {
    useCompose.setState({ phase: 'idle', error: `Trascrizione non riuscita: ${e}` })
  }
}

/** Ask Claude for advice and, with `measures` > 0, the next measures (shown for a decision). */
export async function askClaude(measures: number, request: string): Promise<void> {
  const { musicxml } = useScore.getState()
  if (!musicxml || useCompose.getState().asking) return
  if (!(await ipc.apiKeyStatus())) {
    useOmr.setState({ keyDialog: true })
    return
  }
  useCompose.setState({ asking: true, error: null, problems: [] })
  try {
    const result = await ipc.composeContinue(musicxml, measures, request)
    useCompose.setState({ advice: result.advice, problems: result.problems })
    if (result.added > 0) {
      useCompose.setState({ preview: { before: musicxml, first: result.firstNew, added: result.added } })
      await show(result.musicxml)
    }
  } catch (e) {
    useCompose.setState({ error: String(e) })
  } finally {
    useCompose.setState({ asking: false })
  }
}

async function show(musicxml: string): Promise<void> {
  const { fileName, title } = useScore.getState()
  await openMusicXml(fileName ?? 'idea.musicxml', musicxml, title, { keepTransport: true })
  useScore.getState().set({ unsaved: true })
}

/** Keep Claude's measures. */
export function keepProposal(): void {
  useCompose.setState({ preview: null })
}

/** Drop Claude's measures: the piece as it was. */
export async function discardProposal(): Promise<void> {
  const preview = useCompose.getState().preview
  if (!preview) return
  useCompose.setState({ preview: null })
  await show(preview.before)
}

/** Play from the first new measure. */
export async function listenFrom(ordinal: number): Promise<void> {
  const { measures, measureIds } = useScore.getState()
  const start = measures.find((m) => m.measureId === measureIds[ordinal - 1])
  if (!start || !inTauri) return
  await ipc.seek(start.ms)
  await ipc.play()
}

/** Save the last recording as played (timing, pedal) as a MIDI file. */
export async function savePerformance(): Promise<void> {
  const { midi } = useCompose.getState()
  if (!midi) return
  const path = await save({
    defaultPath: `${useScore.getState().title ?? 'idea'}.mid`,
    filters: [{ name: 'MIDI', extensions: ['mid'] }]
  })
  if (path)
    await ipc.saveBinaryFile(
      path,
      Uint8Array.from(atob(midi), (c) => c.charCodeAt(0))
    )
}
