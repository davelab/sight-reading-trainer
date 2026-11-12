//! Tauri commands exposed to the frontend (see docs/SPEC.md, "Frontend ↔ Rust").
//! Names and payloads must match app/src/lib/ipc.ts.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::engine::EngineClient;
use crate::midi::{self, NoteMessage};
use crate::playback::{Hands, Loop, PlaybackEvent, MAX_TEMPO, MIN_TEMPO};
use crate::score::{read_score, LoadedFile};
use crate::synth::{Engine, SharedEngine, SynthKind};

pub struct AppState {
    pub engine: SharedEngine,
    pub synth: SynthKind,
    pub soundfont: Option<PathBuf>,
    pub midi: Mutex<Option<midi::Connection>>,
    pub analysis: Arc<EngineClient>,
}

/// Generous: music21 on a long piece can take tens of seconds.
const ANALYSIS_TIMEOUT: Duration = Duration::from_secs(180);

type CmdResult<T> = Result<T, String>;

fn lock_engine(engine: &SharedEngine) -> CmdResult<std::sync::MutexGuard<'_, Engine>> {
    engine.lock().map_err(|_| "audio engine poisoned".to_string())
}

fn with_engine<R>(state: &AppState, f: impl FnOnce(&mut Engine) -> R) -> CmdResult<R> {
    Ok(f(&mut *lock_engine(&state.engine)?))
}

/// A note played on the MIDI piano or on the on-screen keyboard: echo it to the
/// UI, feed follow mode and report the measures it completed.
pub fn handle_live_note(app: &AppHandle, engine: &SharedEngine, note: NoteMessage, sound: bool) {
    let results = match engine.lock() {
        Ok(mut e) => {
            if sound {
                e.play_live(note.pitch, note.velocity, note.on);
            }
            if note.on {
                e.follow_note(note.pitch)
            } else {
                Vec::new()
            }
        }
        Err(_) => return,
    };
    let _ = app.emit("midi:note", note);
    for r in results {
        let _ = app.emit("follow:result", r);
    }
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
        e.follow.load(&events);
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

/// Start playback. Leaves follow mode, which is driven by the player instead of the clock.
#[tauri::command]
pub fn play(state: State<'_, AppState>) -> CmdResult<()> {
    with_engine(&state, |e| {
        e.follow.stop();
        e.with_transport(|t, _| t.play())
    })
}

#[tauri::command]
pub fn pause(state: State<'_, AppState>) -> CmdResult<()> {
    with_engine(&state, |e| e.with_transport(|t, out| t.pause(out)))
}

#[tauri::command]
pub fn seek(state: State<'_, AppState>, ms: f64) -> CmdResult<()> {
    with_engine(&state, |e| {
        e.follow.seek(ms);
        let target = e.follow.current_onset().unwrap_or(ms);
        e.with_transport(|t, out| t.seek(target, out))
    })
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
    with_engine(&state, |e| {
        e.with_transport(|t, _| t.set_loop(r#loop));
        e.follow.set_loop(r#loop);
        if let Some(ms) = e.follow.current_onset() {
            e.with_transport(|t, out| t.seek(ms, out));
        }
    })
}

#[tauri::command]
pub fn set_hands(state: State<'_, AppState>, hands: Hands) -> CmdResult<()> {
    with_engine(&state, |e| {
        e.with_transport(|t, out| t.set_hands(hands, out));
        e.follow.set_hands(hands);
        if let Some(ms) = e.follow.current_onset() {
            e.with_transport(|t, out| t.seek(ms, out));
        }
    })
}

/// Turn follow (wait) mode on or off. On: playback stops and the cursor waits
/// on the first chord at or after the current position.
#[tauri::command]
pub fn set_follow_mode(state: State<'_, AppState>, enabled: bool) -> CmdResult<bool> {
    with_engine(&state, |e| {
        if !enabled {
            e.follow.stop();
            return false;
        }
        e.with_transport(|t, out| t.pause(out));
        let pos = e.transport.position_ms();
        let start = if pos >= e.transport.duration_ms() { 0.0 } else { pos };
        e.follow.start(start);
        if let Some(ms) = e.follow.current_onset() {
            e.with_transport(|t, out| t.seek(ms, out));
        }
        e.follow.is_active()
    })
}

#[derive(Serialize)]
pub struct MidiDevices {
    devices: Vec<String>,
    selected: Option<String>,
}

/// List MIDI inputs. A selected device that has disappeared is disconnected.
#[tauri::command]
pub fn midi_list_devices(state: State<'_, AppState>) -> CmdResult<MidiDevices> {
    let devices = midi::list_inputs()?;
    let mut conn = state.midi.lock().map_err(|_| "MIDI state poisoned")?;
    if conn.as_ref().is_some_and(|c| !devices.contains(&c.name)) {
        *conn = None;
    }
    Ok(MidiDevices { devices, selected: conn.as_ref().map(|c| c.name.clone()) })
}

/// Connect to the named MIDI input, or disconnect with `null`.
#[tauri::command]
pub fn midi_select(app: AppHandle, state: State<'_, AppState>, name: Option<String>) -> CmdResult<()> {
    let mut conn = state.midi.lock().map_err(|_| "MIDI state poisoned")?;
    *conn = None; // close the previous port first: some drivers allow one client per port
    if let Some(name) = name {
        let engine = state.engine.clone();
        // The piano makes its own sound: do not echo its notes through the synth.
        *conn = Some(midi::connect(&name, move |note| handle_live_note(&app, &engine, note, false))?);
    }
    Ok(())
}

/// A note from the clickable on-screen keyboard: sounded by the synth and fed
/// to follow mode exactly like a MIDI note.
#[tauri::command]
pub fn virtual_note(app: AppHandle, state: State<'_, AppState>, pitch: u8, on: bool) -> CmdResult<()> {
    if pitch > 127 {
        return Err(format!("nota fuori intervallo: {pitch}"));
    }
    handle_live_note(&app, &state.engine, NoteMessage { pitch, velocity: if on { 90 } else { 0 }, on }, true);
    Ok(())
}

// --- Planned for later milestones -------------------------------------------------

/// Harmonic analysis by the Python engine. Returns the `Analysis` schema
/// (shared/schema/Analysis.json) as JSON. Runs off the main thread.
#[tauri::command]
pub async fn analyze(state: State<'_, AppState>, musicxml: String) -> CmdResult<serde_json::Value> {
    let client = state.analysis.clone();
    tauri::async_runtime::spawn_blocking(move || {
        client.request("analyze", serde_json::json!({ "musicxml": musicxml }), ANALYSIS_TIMEOUT)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn import_pdf() -> CmdResult<()> {
    Err("import PDF (OMR): milestone M5".into())
}
