//! Tauri commands exposed to the frontend (see docs/SPEC.md, "Frontend ↔ Rust").
//! Names and payloads must match app/src/lib/ipc.ts.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::engine::EngineClient;
use crate::midi::{self, NoteMessage};
use crate::playback::{Click, Hands, Loop, PlaybackEvent, MAX_TEMPO, MIN_TEMPO};
use crate::score::{read_score, LoadedFile};
use crate::synth::{Engine, SharedEngine, SynthKind};

pub struct AppState {
    pub engine: SharedEngine,
    pub synth: SynthKind,
    pub soundfont: Option<PathBuf>,
    pub midi: Mutex<Option<midi::Connection>>,
    pub analysis: Arc<EngineClient>,
    pub omr: Arc<EngineClient>,
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
            let now = e.now_ms();
            e.recorder.note(note.pitch, note.velocity, note.on, now);
            if note.on {
                let position = e.transport.position_ms();
                e.timed.note_on(note.pitch, position);
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

/// The sustain pedal of the MIDI piano: recorded, and echoed to the UI (live chords).
pub fn handle_pedal(app: &AppHandle, engine: &SharedEngine, down: bool) {
    if let Ok(mut e) = engine.lock() {
        let now = e.now_ms();
        e.recorder.pedal(down, now);
    }
    let _ = app.emit("midi:pedal", down);
}

/// Start a live recording ("Componi"). Returns the milliseconds until the first
/// downbeat (the count-in), 0 without metronome or count-in.
#[tauri::command]
pub fn record_start(
    state: State<'_, AppState>,
    bpm: Option<f64>,
    beats_per_measure: u32,
    count_in: bool,
) -> CmdResult<f64> {
    with_engine(&state, |e| e.start_recording(bpm, beats_per_measure, count_in))
}

/// Stop the live recording: its notes and pedal, in seconds from the first downbeat.
#[tauri::command]
pub fn record_stop(state: State<'_, AppState>) -> CmdResult<Option<crate::record::Recording>> {
    with_engine(&state, |e| e.stop_recording())
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
        e.stop_timed();
        e.follow.load(&events);
        e.timed.load(&events);
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

/// Leave "A tempo" mode if it is on, reporting its totals as `timed:summary`.
fn end_timed(app: &AppHandle, e: &mut Engine) {
    if let Some(summary) = e.stop_timed() {
        let _ = app.emit("timed:summary", summary);
    }
}

/// Start playback. Leaves follow and "A tempo" modes, driven by the player instead.
#[tauri::command]
pub fn play(app: AppHandle, state: State<'_, AppState>) -> CmdResult<()> {
    with_engine(&state, |e| {
        e.follow.stop();
        end_timed(&app, e);
        e.with_transport(|t, _| t.play())
    })
}

#[tauri::command]
pub fn pause(app: AppHandle, state: State<'_, AppState>) -> CmdResult<()> {
    with_engine(&state, |e| {
        end_timed(&app, e);
        e.with_transport(|t, out| t.pause(out))
    })
}

#[tauri::command]
pub fn seek(app: AppHandle, state: State<'_, AppState>, ms: f64) -> CmdResult<()> {
    with_engine(&state, |e| {
        end_timed(&app, e);
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
        e.timed.set_loop(r#loop);
        if let Some(ms) = e.follow.current_onset() {
            e.with_transport(|t, out| t.seek(ms, out));
        }
    })
}

#[tauri::command]
pub fn set_hands(app: AppHandle, state: State<'_, AppState>, hands: Hands) -> CmdResult<()> {
    with_engine(&state, |e| {
        end_timed(&app, e);
        e.with_transport(|t, out| t.set_hands(hands, out));
        e.follow.set_hands(hands);
        if let Some(ms) = e.follow.current_onset() {
            e.with_transport(|t, out| t.seek(ms, out));
        }
    })
}

/// Output volume, 0.0–1.0.
#[tauri::command]
pub fn set_volume(state: State<'_, AppState>, volume: f32) -> CmdResult<()> {
    with_engine(&state, |e| e.set_volume(volume))
}

/// Reverb amount, 0.0–1.0.
#[tauri::command]
pub fn set_reverb(state: State<'_, AppState>, amount: f32) -> CmdResult<()> {
    with_engine(&state, |e| e.set_reverb(amount))
}

/// Transpose playback and follow mode, in semitones (-24..=24).
#[tauri::command]
pub fn set_transpose(state: State<'_, AppState>, semitones: i8) -> CmdResult<()> {
    with_engine(&state, |e| e.set_transpose(semitones))
}

/// Turn follow (wait) mode on or off. On: playback stops and the cursor waits
/// on the first chord at or after the current position.
#[tauri::command]
pub fn set_follow_mode(app: AppHandle, state: State<'_, AppState>, enabled: bool) -> CmdResult<bool> {
    with_engine(&state, |e| {
        end_timed(&app, e);
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

/// Metronome beats of the loaded score (built by the frontend from the measures).
#[tauri::command]
pub fn set_clicks(state: State<'_, AppState>, clicks: Vec<Click>) -> CmdResult<()> {
    with_engine(&state, |e| e.with_transport(|t, _| t.set_clicks(clicks)))
}

/// Metronome on or off, in any mode.
#[tauri::command]
pub fn set_metronome(state: State<'_, AppState>, enabled: bool) -> CmdResult<()> {
    with_engine(&state, |e| e.with_transport(|t, out| t.set_metronome(enabled, out)))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CountInArg {
    beats: u32,
    beat_ms: f64,
}

/// "A tempo" mode: the music runs at the set tempo from the current position
/// (after `count_in`), and every note played is judged within `tolerance_ms`
/// (real time). Results arrive as `timed:result` per measure and
/// `timed:summary` at the end.
#[tauri::command]
pub fn start_timed_mode(
    state: State<'_, AppState>,
    tolerance_ms: f64,
    count_in: Option<CountInArg>,
    any_key: Option<bool>,
) -> CmdResult<()> {
    if !tolerance_ms.is_finite() || !(20.0..=500.0).contains(&tolerance_ms) {
        return Err(format!("tolleranza fuori intervallo: {tolerance_ms} ms"));
    }
    with_engine(&state, |e| {
        e.start_timed(tolerance_ms, count_in.map(|c| (c.beats.min(8), c.beat_ms)), any_key.unwrap_or(false))
    })
}

#[tauri::command]
pub fn stop_timed_mode(app: AppHandle, state: State<'_, AppState>) -> CmdResult<()> {
    with_engine(&state, |e| end_timed(&app, e))
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
        let (app2, engine2) = (app.clone(), engine.clone());
        // The piano makes its own sound: do not echo its notes through the synth.
        *conn = Some(midi::connect(
            &name,
            move |note| handle_live_note(&app, &engine, note, false),
            move |down| handle_pedal(&app2, &engine2, down),
        )?);
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

/// Start recognising a PDF in the `omr` sidecar. Returns `{jobId}` at once;
/// progress and outcome arrive as `omr:progress`, `omr:done`, `omr:failed`.
#[tauri::command]
pub async fn import_pdf(
    state: State<'_, AppState>,
    path: String,
    pages: Option<Vec<u32>>,
) -> CmdResult<serde_json::Value> {
    let client = state.omr.clone();
    let mut params = serde_json::json!({ "pdfPath": path });
    if let Some(pages) = pages {
        params["pages"] = serde_json::json!(pages);
    }
    // The first call starts the sidecar (a large binary): allow for it.
    tauri::async_runtime::spawn_blocking(move || client.request("omr.run", params, Duration::from_secs(120)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn omr_cancel(state: State<'_, AppState>, job_id: String) -> CmdResult<serde_json::Value> {
    let client = state.omr.clone();
    tauri::async_runtime::spawn_blocking(move || {
        client.request("omr.cancel", serde_json::json!({ "jobId": job_id }), Duration::from_secs(10))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Start transcribing a piano recording (mp3, wav, m4a, ...) in the `omr` sidecar,
/// which also runs the transcription model. Returns `{jobId}` at once; progress
/// and outcome arrive as `transcribe:progress`, `transcribe:done`, `transcribe:failed`.
#[tauri::command]
pub async fn transcribe_audio(
    state: State<'_, AppState>,
    path: String,
    hints: Option<serde_json::Value>,
) -> CmdResult<serde_json::Value> {
    let client = state.omr.clone();
    // `hints`: what the user knows (TranscribeHints: tempo, meter, key, pickup).
    let params = serde_json::json!({ "audioPath": path, "hints": hints });
    tauri::async_runtime::spawn_blocking(move || client.request("transcribe.run", params, Duration::from_secs(120)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn transcribe_cancel(state: State<'_, AppState>, job_id: String) -> CmdResult<serde_json::Value> {
    let client = state.omr.clone();
    tauri::async_runtime::spawn_blocking(move || {
        client.request("transcribe.cancel", serde_json::json!({ "jobId": job_id }), Duration::from_secs(10))
    })
    .await
    .map_err(|e| e.to_string())?
}

// --- Claude API key (macOS Keychain) and second reading of measures -----------

const KEYCHAIN_SERVICE: &str = "Score Studio";
const KEYCHAIN_ACCOUNT: &str = "anthropic-api-key";

fn keychain() -> CmdResult<keyring::Entry> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| format!("Portachiavi non disponibile: {e}"))
}

fn stored_api_key() -> CmdResult<Option<String>> {
    match keychain()?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("impossibile leggere la chiave dal Portachiavi: {e}")),
    }
}

/// Whether a Claude API key is stored (the key itself never goes to the frontend).
#[tauri::command]
pub fn api_key_status() -> CmdResult<bool> {
    Ok(stored_api_key()?.is_some())
}

/// Store the Claude API key in the Keychain, or remove it (`None` or empty).
#[tauri::command]
pub fn set_api_key(key: Option<String>) -> CmdResult<()> {
    let entry = keychain()?;
    match key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty()) {
        Some(k) if !k.starts_with("sk-ant-") => {
            Err("non sembra una chiave API di Anthropic (inizia con sk-ant-)".into())
        }
        Some(k) => entry.set_password(&k).map_err(|e| format!("impossibile salvare la chiave: {e}")),
        None => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("impossibile rimuovere la chiave: {e}")),
        },
    }
}

/// Claude reads the suspicious measures of a recognised PDF again (engine `omr.refine`),
/// plus `extra_measures` picked by the user. Returns the `RefineResult` schema.
#[tauri::command]
pub async fn omr_refine(
    state: State<'_, AppState>,
    pdf_path: String,
    musicxml: String,
    extra_measures: Vec<u32>,
) -> CmdResult<serde_json::Value> {
    let key = stored_api_key()?.ok_or("manca la chiave API di Claude")?;
    let client = state.omr.clone();
    let params = serde_json::json!({
        "pdfPath": pdf_path, "musicxml": musicxml, "extraMeasures": extra_measures, "apiKey": key,
    });
    // A careful reading of a few measures can take a few minutes.
    tauri::async_runtime::spawn_blocking(move || client.request("omr.refine", params, Duration::from_secs(900)))
        .await
        .map_err(|e| e.to_string())?
}

/// Correct one note of a recognised score (see engine `score.edit`).
#[tauri::command]
pub async fn score_edit(
    state: State<'_, AppState>,
    musicxml: String,
    note: serde_json::Value,
    action: String,
    value: Option<String>,
) -> CmdResult<serde_json::Value> {
    let client = state.analysis.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let params = serde_json::json!({ "musicxml": musicxml, "note": note, "action": action, "value": value });
        client.request("score.edit", params, Duration::from_secs(30))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn score_check(state: State<'_, AppState>, musicxml: String) -> CmdResult<serde_json::Value> {
    let client = state.analysis.clone();
    tauri::async_runtime::spawn_blocking(move || {
        client.request("score.check", serde_json::json!({ "musicxml": musicxml }), Duration::from_secs(30))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Write a binary file chosen by the user in a save dialog (MIDI export).
#[tauri::command]
pub fn save_binary_file(path: String, contents: Vec<u8>) -> CmdResult<()> {
    std::fs::write(&path, contents).map_err(|e| format!("impossibile salvare {path}: {e}"))
}

/// Write a text file chosen by the user in a save dialog (MusicXML export).
#[tauri::command]
pub fn save_text_file(path: String, contents: String) -> CmdResult<()> {
    std::fs::write(&path, contents).map_err(|e| format!("impossibile salvare {path}: {e}"))
}
