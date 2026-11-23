/**
 * Verovio note IDs → musical positions, the only way the engine finds a note
 * to correct (CLAUDE.md: never by ID). Built once per loaded score.
 */
import type { NoteRef } from '../types'
import type { MeasureOnset, PlaybackEvent } from './timemap'

export function buildNoteRefs(
  onsets: ReadonlyMap<string, MeasureOnset[]>,
  measureIds: readonly string[],
  events: readonly PlaybackEvent[]
): Map<string, NoteRef> {
  const byId = new Map(events.map((e) => [e.noteId, e]))
  const refs = new Map<string, NoteRef>()
  measureIds.forEach((measureId, i) => {
    for (const onset of onsets.get(measureId) ?? []) {
      for (const noteId of onset.noteIds) {
        const e = byId.get(noteId)
        if (e) refs.set(noteId, { measure: i + 1, staff: e.staff, offset: onset.q, pitch: e.pitch })
      }
    }
  })
  return refs
}

/** After an edit the note's ID changes: find it again by position, nearest pitch. */
export function findNote(refs: ReadonlyMap<string, NoteRef>, near: NoteRef): string | null {
  let best: { id: string; distance: number } | null = null
  for (const [id, r] of refs) {
    if (r.measure !== near.measure || r.staff !== near.staff || Math.abs(r.offset - near.offset) > 1e-3) continue
    const distance = Math.abs(r.pitch - near.pitch)
    if (!best || distance < best.distance) best = { id, distance }
  }
  return best?.id ?? null
}

const NAMES = ['Do', 'Do♯', 'Re', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si']

/** "Do♯5" (sharps/flats chosen for display only). */
export function pitchName(midi: number): string {
  return `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`
}
