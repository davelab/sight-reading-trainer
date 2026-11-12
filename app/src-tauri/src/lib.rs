mod commands;
mod engine;
mod follow;
mod midi;
mod playback;
mod score;
mod synth;

use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use commands::AppState;
use synth::SharedEngine;

/// Cursor refresh rate while playing.
const POSITION_INTERVAL: Duration = Duration::from_millis(16);

#[derive(Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct PositionEvent {
    note_ids: Vec<String>,
    ms: f64,
    playing: bool,
    /// Follow mode is on: `noteIds` are the notes the player must play now.
    following: bool,
    /// Pitches of the current chord not played yet (follow mode only).
    expected_pitches: Vec<u8>,
}

/// Emit `playback:position` ~60 times a second while it changes (playing, or
/// follow mode moving on), and never while nothing changes.
fn spawn_position_emitter(app: AppHandle, engine: SharedEngine) {
    thread::Builder::new()
        .name("position".into())
        .spawn(move || {
            let mut last: Option<PositionEvent> = None;
            loop {
                thread::sleep(POSITION_INTERVAL);
                let event = match engine.lock() {
                    Ok(e) if e.follow.is_active() => PositionEvent {
                        note_ids: e.follow.expected_note_ids(),
                        ms: e.transport.position_ms(),
                        playing: false,
                        following: true,
                        expected_pitches: e.follow.expected_pitches(),
                    },
                    Ok(e) => PositionEvent {
                        note_ids: e.transport.current_note_ids(),
                        ms: e.transport.position_ms(),
                        playing: e.transport.is_playing(),
                        following: false,
                        expected_pitches: Vec::new(),
                    },
                    Err(_) => return,
                };
                if last.as_ref() != Some(&event) {
                    let _ = app.emit("playback:position", &event);
                    last = Some(event);
                }
            }
        })
        .expect("spawn position thread");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let mut dirs = Vec::new();
            if let Ok(res) = app.path().resource_dir() {
                dirs.push(res.join("resources"));
            }
            // `pnpm tauri dev`: also look in the source tree.
            dirs.push(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources"));
            let soundfont = synth::find_soundfont(&dirs);
            let (engine, status) = synth::start(soundfont);
            spawn_position_emitter(app.handle().clone(), engine.clone());
            let analysis = std::sync::Arc::new(engine::EngineClient::new("engine", engine::Launcher::locate("engine")));
            analysis.warm_up();
            // The OMR sidecar starts on the first import; its models live in the app data dir.
            let data_dir = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("score-studio"));
            let omr_launcher = engine::Launcher::locate("omr")
                .map(|l| l.with_env("SCORE_STUDIO_DATA_DIR", data_dir.to_string_lossy()));
            let omr = std::sync::Arc::new(engine::EngineClient::new("omr", omr_launcher));
            let handle = app.handle().clone();
            omr.set_notification_handler(std::sync::Arc::new(move |method, params| {
                // omr.progress -> omr:progress, omr.done -> omr:done, omr.failed -> omr:failed
                if let Some(event) = method.strip_prefix("omr.") {
                    let _ = handle.emit(&format!("omr:{event}"), params);
                }
            }));
            app.manage(AppState {
                engine,
                synth: status.kind,
                soundfont: status.soundfont,
                midi: Default::default(),
                analysis,
                omr,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_score,
            commands::initial_file,
            commands::playback_load,
            commands::play,
            commands::pause,
            commands::seek,
            commands::set_tempo,
            commands::set_loop,
            commands::set_hands,
            commands::analyze,
            commands::import_pdf,
            commands::omr_cancel,
            commands::score_edit,
            commands::score_check,
            commands::save_text_file,
            commands::midi_list_devices,
            commands::midi_select,
            commands::set_follow_mode,
            commands::virtual_note,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Score Studio");
}
