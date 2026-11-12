mod commands;
mod engine;
mod follow;
mod midi;
mod playback;
mod score;
mod synth;
mod timed;

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
    /// "A tempo" mode is on.
    timed: bool,
    /// The metronome is counting in before the music starts.
    counting_in: bool,
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
                let mut results = Vec::new();
                let mut judged = Vec::new();
                let mut summary = None;
                let event = match engine.lock() {
                    Ok(e) if e.follow.is_active() => PositionEvent {
                        note_ids: e.follow.expected_note_ids(),
                        ms: e.transport.position_ms(),
                        playing: false,
                        following: true,
                        expected_pitches: e.follow.expected_pitches(),
                        timed: false,
                        counting_in: false,
                    },
                    Ok(mut e) => {
                        if e.timed.is_active() {
                            let pos = e.transport.position_ms();
                            results = e.timed.tick(pos);
                            if !e.transport.is_playing() {
                                // The music reached the end: the run is over.
                                results.extend(e.timed.tick(f64::INFINITY));
                                judged = e.timed.drain_judged();
                                summary = e.stop_timed();
                            } else {
                                judged = e.timed.drain_judged();
                            }
                        }
                        PositionEvent {
                            note_ids: e.transport.current_note_ids(),
                            ms: e.transport.position_ms(),
                            playing: e.transport.is_playing(),
                            following: false,
                            expected_pitches: Vec::new(),
                            timed: e.timed.is_active(),
                            counting_in: e.transport.counting_in(),
                        }
                    }
                    Err(_) => return,
                };
                for r in results {
                    let _ = app.emit("timed:result", r);
                }
                if !judged.is_empty() {
                    let _ = app.emit("timed:notes", &judged);
                }
                if let Some(s) = summary {
                    let _ = app.emit("timed:summary", s);
                }
                if last.as_ref() != Some(&event) {
                    let _ = app.emit("playback:position", &event);
                    last = Some(event);
                }
            }
        })
        .expect("spawn position thread");
}

/// Event name parts for a sidecar job notification (`omr.*`, `transcribe.*`).
fn notification_event(method: &str) -> Option<(&str, &str)> {
    let (job, event) = method.split_once('.')?;
    matches!(job, "omr" | "transcribe").then_some((job, event))
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
            // The same sidecar transcribes audio; the model ships in the resources.
            let resources = dirs.iter().find(|d| d.is_dir()).cloned().unwrap_or_default();
            let omr_launcher = engine::Launcher::locate("omr").map(|l| {
                l.with_env("SCORE_STUDIO_DATA_DIR", data_dir.to_string_lossy())
                    .with_env("SCORE_STUDIO_RESOURCES", resources.to_string_lossy())
            });
            let omr = std::sync::Arc::new(engine::EngineClient::new("omr", omr_launcher));
            let handle = app.handle().clone();
            omr.set_notification_handler(std::sync::Arc::new(move |method, params| {
                // omr.progress -> omr:progress, transcribe.done -> transcribe:done, ...
                if let Some((job, event)) = notification_event(method) {
                    let _ = handle.emit(&format!("{job}:{event}"), params);
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
            commands::set_volume,
            commands::set_reverb,
            commands::set_transpose,
            commands::analyze,
            commands::import_pdf,
            commands::omr_cancel,
            commands::omr_refine,
            commands::api_key_status,
            commands::set_api_key,
            commands::transcribe_audio,
            commands::transcribe_cancel,
            commands::save_binary_file,
            commands::score_edit,
            commands::score_check,
            commands::save_text_file,
            commands::midi_list_devices,
            commands::midi_select,
            commands::set_follow_mode,
            commands::set_clicks,
            commands::set_metronome,
            commands::start_timed_mode,
            commands::stop_timed_mode,
            commands::virtual_note,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Score Studio");
}

#[cfg(test)]
mod tests {
    use super::notification_event;

    #[test]
    fn job_notifications_become_events() {
        assert_eq!(notification_event("omr.progress"), Some(("omr", "progress")));
        assert_eq!(notification_event("transcribe.done"), Some(("transcribe", "done")));
        assert_eq!(notification_event("analyze.done"), None);
        assert_eq!(notification_event("ping"), None);
    }
}
