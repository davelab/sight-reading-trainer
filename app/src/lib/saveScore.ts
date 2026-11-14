import { ask, save } from '@tauri-apps/plugin-dialog'
import { useScore } from '../stores/score'
import { inTauri, ipc } from './ipc'

/** "Minuetto.pdf" / "Minuetto.musicxml" -> "Minuetto.musicxml". */
export function musicxmlName(fileName: string | null, title: string | null): string {
  const base = (fileName ?? title ?? 'spartito').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '-')
  return `${base || 'spartito'}.musicxml`
}

/** Save the open score as MusicXML (a save dialog; a download in the browser). Returns true when saved. */
export async function saveScore(): Promise<boolean> {
  const { musicxml, fileName, title } = useScore.getState()
  if (!musicxml) return false
  const name = musicxmlName(fileName, title)
  if (!inTauri) {
    const url = URL.createObjectURL(new Blob([musicxml], { type: 'application/vnd.recordare.musicxml+xml' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
    useScore.getState().set({ unsaved: false })
    return true
  }
  const path = await save({ defaultPath: name, filters: [{ name: 'MusicXML', extensions: ['musicxml', 'xml'] }] })
  if (!path) return false
  await ipc.saveTextFile(path, musicxml)
  useScore.getState().set({ unsaved: false, fileName: path.split(/[\\/]/).pop() ?? name })
  return true
}

/** Before another file replaces a corrected score not saved yet: offer to save it. */
export async function offerToSave(): Promise<void> {
  if (!inTauri || !useScore.getState().unsaved) return
  const yes = await ask('Lo spartito corretto non è stato salvato. Salvarlo prima di aprire un altro file?', {
    title: 'Modifiche non salvate',
    kind: 'warning',
    okLabel: 'Salva',
    cancelLabel: 'Non salvare'
  })
  if (yes) await saveScore()
}
