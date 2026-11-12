import { inTauri, ipc } from './ipc'
import { buildNoteRefs } from './noteRefs'
import { scoreDurationMs } from './timemap'
import { loadScore } from './verovio'
import { runAnalysis, useAnalysis } from '../stores/analysis'
import { startAudioTranscription, startPdfImport } from '../stores/omr'
import { useMidi } from '../stores/midi'
import { useScore } from '../stores/score'
import { useTransport } from '../stores/transport'
import { useView } from '../stores/view'

export const SCORE_EXTENSIONS = ['musicxml', 'xml', 'mxl', 'pdf']
/** Piano recordings the transcription accepts (engine/score_engine/transcribe/jobs.py). */
export const AUDIO_EXTENSIONS = ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'aif', 'aiff', 'caf']

export function isAudioFile(name: string): boolean {
  return AUDIO_EXTENSIONS.includes(name.split('.').pop()?.toLowerCase() ?? '')
}

export function isScoreFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return SCORE_EXTENSIONS.includes(ext)
}

function titleFromXml(xml: string): string | null {
  const m = /<work-title>([^<]+)<\/work-title>/.exec(xml) ?? /<movement-title>([^<]+)<\/movement-title>/.exec(xml)
  return m ? m[1].trim() : null
}

export interface OpenOptions {
  /** Run the harmonic analysis (not while a recognised score is being corrected). */
  analyze?: boolean
  /** Keep tempo, loop and position (re-rendering after a correction). */
  keepTransport?: boolean
}

export async function openMusicXml(
  fileName: string,
  musicxml: string,
  title: string | null,
  { analyze = true, keepTransport = false }: OpenOptions = {}
): Promise<void> {
  const score = useScore.getState()
  const { events, measures, onsets, measureLabels, measureIds } = await loadScore(musicxml)
  score.set({
    fileName,
    title: title ?? titleFromXml(musicxml) ?? fileName,
    musicxml,
    events,
    measures,
    onsets,
    measureLabels,
    measureIds,
    noteRefs: buildNoteRefs(onsets, measureIds, events),
    error: null
  })
  if (analyze)
    void runAnalysis(musicxml) // in the background: the score is usable meanwhile
  else useAnalysis.setState({ analysis: null, status: 'idle', error: null, selectedPattern: null })

  const transport = useTransport.getState()
  if (keepTransport && inTauri) {
    transport.set({ loop: null, pendingLoopStart: null }) // loading clears the loop in Rust
    await ipc.playbackLoad(events)
    await Promise.all([ipc.setTempo(transport.tempoPercent), ipc.setHands(transport.hands)])
    return
  }
  transport.set({ playing: false, positionMs: 0, currentNoteIds: [], loop: null, pendingLoopStart: null })
  // A new piece starts in its written key; the other view settings stay as chosen.
  if (useView.getState().transpose !== 0) useView.getState().set({ transpose: 0 })
  useMidi.getState().set({ following: false, expectedPitches: [], results: {} })
  if (!inTauri) {
    transport.set({ info: { durationMs: scoreDurationMs(events), synth: 'none', soundfontName: null } })
    return
  }
  const info = await ipc.playbackLoad(events)
  await Promise.all([ipc.setTempo(transport.tempoPercent), ipc.setHands(transport.hands), ipc.setLoop(null)])
  transport.set({ info })
}

async function withLoading(task: () => Promise<void>): Promise<void> {
  const score = useScore.getState()
  score.set({ loading: true, error: null })
  try {
    await task()
  } catch (e) {
    score.set({ error: e instanceof Error ? e.message : String(e) })
  } finally {
    useScore.getState().set({ loading: false })
  }
}

/** Open a file by path through the Rust core (Tauri only; handles .mxl and PDF import). */
export function openScorePath(path: string): Promise<void> {
  if (path.toLowerCase().endsWith('.pdf')) return startPdfImport(path)
  if (isAudioFile(path)) return startAudioTranscription(path)
  return withLoading(async () => {
    if (!isScoreFile(path)) {
      throw new Error('Formato non supportato: usa .musicxml, .xml, .mxl, .pdf o una registrazione audio')
    }
    const file = await ipc.loadScore(path)
    await openMusicXml(file.fileName, file.musicxml, null)
  })
}

/** Open a File object (browser fallback for `pnpm dev`, uncompressed MusicXML only). */
export function openScoreFile(file: File): Promise<void> {
  return withLoading(async () => {
    if (file.name.toLowerCase().endsWith('.mxl')) {
      throw new Error("I file .mxl si aprono nell'app desktop; nel browser usa .musicxml")
    }
    await openMusicXml(file.name, await file.text(), null)
  })
}
