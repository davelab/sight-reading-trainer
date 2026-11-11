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
}

/// Emit `playback:position` ~60 times a second while playing, and once on every change.
fn spawn_position_emitter(app: AppHandle, engine: SharedEngine) {
    thread::Builder::new()
        .name("position".into())
        .spawn(move || {
            let mut last: Option<PositionEvent> = None;
            loop {
                thread::sleep(POSITION_INTERVAL);
                let event = match engine.lock() {
                    Ok(e) => PositionEvent {
                        note_ids: e.transport.current_note_ids(),
                        ms: e.transport.position_ms(),
                        playing: e.transport.is_playing(),
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
            app.manage(AppState { engine, synth: status.kind, soundfont: status.soundfont });
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
            commands::midi_list_devices,
            commands::midi_select,
            commands::set_follow_mode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Score Studio");
}
