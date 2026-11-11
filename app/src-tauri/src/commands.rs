//! Tauri commands exposed to the frontend (see docs/SPEC.md, "Frontend ↔ Rust").
//! Names and payloads must match app/src/lib/ipc.ts.

use std::path::PathBuf;

use serde::Serialize;
use tauri::State;

use crate::playback::{Hands, Loop, PlaybackEvent, MAX_TEMPO, MIN_TEMPO};
use crate::score::{read_score, LoadedFile};
use crate::synth::{SharedEngine, SynthKind};

pub struct AppState {
    pub engine: SharedEngine,
    pub synth: SynthKind,
    pub soundfont: Option<PathBuf>,
}

type CmdResult<T> = Result<T, String>;

fn with_engine<R>(state: &AppState, f: impl FnOnce(&mut crate::synth::Engine) -> R) -> CmdResult<R> {
    let mut engine = state.engine.lock().map_err(|_| "audio engine poisoned".to_string())?;
    Ok(f(&mut engine))
}

#[tauri::command]
pub fn load_score(path: String) -> CmdResult<LoadedFile> {
    read_score(&PathBuf::from(path))
}

/// Score file passed on the command line (`score-studio path/to/score.musicxml`), if any.
#[tauri::command]
pub fn initial_file() -> Option<String> {
    std::env::args_os().skip(1).map(PathBuf::from).find(|p| p.is_file()).map(|p| p.to_string_lossy().into_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackInfo {
    duration_ms: f64,
    synth: SynthKind,
    soundfont_name: Option<String>,
}

/// Receive the playback events built from Verovio's timemap (once per score).
#[tauri::command]
pub fn playback_load(state: State<'_, AppState>, events: Vec<PlaybackEvent>) -> CmdResult<PlaybackInfo> {
    let duration_ms = with_engine(&state, |e| {
        e.with_transport(|t, out| {
            t.load(events, out);
            t.duration_ms()
        })
    })?;
    Ok(PlaybackInfo {
        duration_ms,
        synth: state.synth,
        soundfont_name: state.soundfont.as_ref().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().into_owned()),
    })
}

#[tauri::command]
pub fn play(state: State<'_, AppState>) -> CmdResult<()> {
    with_engine(&state, |e| e.with_transport(|t, _| t.play()))
}

#[tauri::command]
pub fn pause(state: State<'_, AppState>) -> CmdResult<()> {
    with_engine(&state, |e| e.with_transport(|t, out| t.pause(out)))
}

#[tauri::command]
pub fn seek(state: State<'_, AppState>, ms: f64) -> CmdResult<()> {
    with_engine(&state, |e| e.with_transport(|t, out| t.seek(ms, out)))
}

/// Tempo in percent of the written tempo (25–200).
#[tauri::command]
pub fn set_tempo(state: State<'_, AppState>, percent: f64) -> CmdResult<()> {
    if !percent.is_finite() || !(MIN_TEMPO * 100.0..=MAX_TEMPO * 100.0).contains(&percent) {
        return Err(format!("tempo fuori intervallo: {percent}%"));
    }
    with_engine(&state, |e| e.with_transport(|t, _| t.set_rate(percent / 100.0)))
}

#[tauri::command]
pub fn set_loop(state: State<'_, AppState>, r#loop: Option<Loop>) -> CmdResult<()> {
    with_engine(&state, |e| e.with_transport(|t, _| t.set_loop(r#loop)))
}

#[tauri::command]
pub fn set_hands(state: State<'_, AppState>, hands: Hands) -> CmdResult<()> {
    with_engine(&state, |e| e.with_transport(|t, out| t.set_hands(hands, out)))
}

// --- Planned for later milestones -------------------------------------------------

#[tauri::command]
pub fn analyze() -> CmdResult<()> {
    Err("analisi armonica: milestone M3".into())
}

#[tauri::command]
pub fn import_pdf() -> CmdResult<()> {
    Err("import PDF (OMR): milestone M5".into())
}

#[tauri::command]
pub fn midi_list_devices() -> CmdResult<Vec<String>> {
    Err("input MIDI: milestone M2".into())
}

#[tauri::command]
pub fn midi_select() -> CmdResult<()> {
    Err("input MIDI: milestone M2".into())
}

#[tauri::command]
pub fn set_follow_mode() -> CmdResult<()> {
    Err("modalità segui: milestone M2".into())
}
