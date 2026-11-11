/**
 * Typed wrappers for the Tauri commands and events exposed by the Rust core
 * (see docs/SPEC.md, "Frontend ↔ Rust"). Names and payloads must match
 * app/src-tauri/src/commands.rs.
 */
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { PlaybackEvent } from './timemap'

export type Hands = 'both' | 'right' | 'left'

export interface LoadedFile {
  fileName: string
  musicxml: string
}

export interface PlaybackInfo {
  durationMs: number
  /** "soundfont" when a .sf2 was found, "fallback" for the built-in sine synth, "none" without audio output. */
  synth: 'soundfont' | 'fallback' | 'none'
  soundfontName: string | null
}

export interface Loop {
  startMs: number
  endMs: number
}

export interface PlaybackPosition {
  /** Sounding notes; in follow mode the notes to play now. */
  noteIds: string[]
  ms: number
  playing: boolean
  following: boolean
  /** Pitches of the current chord still to play (follow mode). */
  expectedPitches: number[]
}

export interface MidiNote {
  pitch: number
  velocity: number
  on: boolean
}

export interface MeasureResult {
  measure: number
  correct: number
  wrong: number
}

export interface MidiDevices {
  devices: string[]
  selected: string | null
}

/** True inside the Tauri webview; false when the UI runs in a plain browser (`pnpm dev`). */
export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const ipc = {
  loadScore: (path: string) => invoke<LoadedFile>('load_score', { path }),
  initialFile: () => invoke<string | null>('initial_file'),
  playbackLoad: (events: PlaybackEvent[]) => invoke<PlaybackInfo>('playback_load', { events }),
  play: () => invoke<void>('play'),
  pause: () => invoke<void>('pause'),
  seek: (ms: number) => invoke<void>('seek', { ms }),
  setTempo: (percent: number) => invoke<void>('set_tempo', { percent }),
  setLoop: (loop: Loop | null) => invoke<void>('set_loop', { loop }),
  setHands: (hands: Hands) => invoke<void>('set_hands', { hands }),
  /** Returns whether follow mode is now active. */
  setFollowMode: (enabled: boolean) => invoke<boolean>('set_follow_mode', { enabled }),
  midiListDevices: () => invoke<MidiDevices>('midi_list_devices'),
  midiSelect: (name: string | null) => invoke<void>('midi_select', { name }),
  virtualNote: (pitch: number, on: boolean) => invoke<void>('virtual_note', { pitch, on })
}

export function onPlaybackPosition(cb: (p: PlaybackPosition) => void): Promise<UnlistenFn> {
  return listen<PlaybackPosition>('playback:position', (e) => cb(e.payload))
}

export function onMidiNote(cb: (n: MidiNote) => void): Promise<UnlistenFn> {
  return listen<MidiNote>('midi:note', (e) => cb(e.payload))
}

export function onFollowResult(cb: (r: MeasureResult) => void): Promise<UnlistenFn> {
  return listen<MeasureResult>('follow:result', (e) => cb(e.payload))
}
