import { inTauri, ipc } from './ipc'
import { scoreDurationMs } from './timemap'
import { loadScore } from './verovio'
import { useMidi } from '../stores/midi'
import { useScore } from '../stores/score'
import { useTransport } from '../stores/transport'

export const SCORE_EXTENSIONS = ['musicxml', 'xml', 'mxl']

export function isScoreFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return SCORE_EXTENSIONS.includes(ext)
}

function titleFromXml(xml: string): string | null {
  const m = /<work-title>([^<]+)<\/work-title>/.exec(xml) ?? /<movement-title>([^<]+)<\/movement-title>/.exec(xml)
  return m ? m[1].trim() : null
}

async function openMusicXml(fileName: string, musicxml: string, title: string | null): Promise<void> {
  const score = useScore.getState()
  const { events, measures } = await loadScore(musicxml)
  score.set({ fileName, title: title ?? titleFromXml(musicxml) ?? fileName, musicxml, events, measures, error: null })

  const transport = useTransport.getState()
  transport.set({ playing: false, positionMs: 0, currentNoteIds: [], loop: null, pendingLoopStart: null })
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

/** Open a file by path through the Rust core (Tauri only; handles .mxl). */
export function openScorePath(path: string): Promise<void> {
  return withLoading(async () => {
    if (!isScoreFile(path)) throw new Error('Formato non supportato: usa .musicxml, .xml o .mxl')
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
