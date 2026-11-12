//! Audio: SoundFont synth (rustysynth) on a cpal output stream.
//!
//! The audio callback owns the timing: it advances the [`Transport`] by one
//! sub-block, applies the due MIDI actions to the synth and renders that
//! sub-block. Without a SoundFont a small additive "fallback" synth keeps the
//! app audible; without an output device a wall-clock thread keeps the
//! transport (and so the cursor) moving.

use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rustysynth::{SoundFont, Synthesizer, SynthesizerSettings};
use serde::Serialize;

use crate::follow::Follow;
use crate::playback::{MidiAction, Transport};
use crate::timed::{Timed, TimedSummary};

/// Frames rendered between two scheduler ticks (≈ 1.5 ms at 44.1 kHz).
pub const BLOCK_FRAMES: usize = 64;

pub trait Synth: Send {
    fn apply(&mut self, action: MidiAction);
    /// Render `left.len()` frames, overwriting both buffers.
    fn render(&mut self, left: &mut [f32], right: &mut [f32]);
    /// Output level, 0.0–1.0 (0.5 is the synth's default level).
    fn set_volume(&mut self, volume: f32);
    /// Reverb amount, 0.0–1.0 (ignored by synths without reverb).
    fn set_reverb(&mut self, _amount: f32) {}
}

/// Default levels, as the UI starts.
pub const DEFAULT_VOLUME: f32 = 0.5;
pub const DEFAULT_REVERB: f32 = 0.3;

// --- SoundFont synth ------------------------------------------------------------

pub struct SoundFontSynth {
    synth: Synthesizer,
}

impl SoundFontSynth {
    pub fn load(path: &Path, sample_rate: u32) -> Result<Self, String> {
        let mut file = File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
        let sound_font = Arc::new(SoundFont::new(&mut file).map_err(|e| format!("{}: {e:?}", path.display()))?);
        let settings = SynthesizerSettings::new(sample_rate as i32);
        let synth = Synthesizer::new(&sound_font, &settings).map_err(|e| format!("{e:?}"))?;
        Ok(Self { synth })
    }
}

impl Synth for SoundFontSynth {
    fn apply(&mut self, action: MidiAction) {
        match action {
            MidiAction::NoteOn { channel, key, velocity } => {
                self.synth.note_on(channel as i32, key as i32, velocity as i32)
            }
            MidiAction::NoteOff { channel, key } => self.synth.note_off(channel as i32, key as i32),
        }
    }

    fn render(&mut self, left: &mut [f32], right: &mut [f32]) {
        self.synth.render(left, right);
    }

    fn set_volume(&mut self, volume: f32) {
        self.synth.set_master_volume(volume.clamp(0.0, 1.0));
    }

    fn set_reverb(&mut self, amount: f32) {
        let send = (amount.clamp(0.0, 1.0) * 127.0).round() as i32;
        for channel in 0..16 {
            self.synth.process_midi_message(channel, 0xB0, 0x5B, send); // CC 91: reverb send
        }
    }
}

// --- Fallback synth -------------------------------------------------------------

struct Voice {
    channel: u8,
    key: u8,
    phase: f32,
    step: f32,
    amp: f32,
    age: f32,
    released: bool,
    level: f32,
}

/// Minimal additive piano-ish synth used when no SoundFont is installed.
pub struct FallbackSynth {
    sample_rate: f32,
    voices: Vec<Voice>,
    gain: f32,
}

const MAX_VOICES: usize = 48;

impl FallbackSynth {
    pub fn new(sample_rate: u32) -> Self {
        Self { sample_rate: sample_rate as f32, voices: Vec::with_capacity(MAX_VOICES), gain: 1.0 }
    }
}

impl Synth for FallbackSynth {
    fn apply(&mut self, action: MidiAction) {
        match action {
            MidiAction::NoteOn { channel, key, velocity } => {
                if self.voices.len() >= MAX_VOICES {
                    self.voices.remove(0);
                }
                let freq = 440.0 * 2f32.powf((key as f32 - 69.0) / 12.0);
                self.voices.push(Voice {
                    channel,
                    key,
                    phase: 0.0,
                    step: std::f32::consts::TAU * freq / self.sample_rate,
                    amp: (velocity as f32 / 127.0).powf(1.5) * 0.18,
                    age: 0.0,
                    released: false,
                    level: 1.0,
                });
            }
            MidiAction::NoteOff { channel, key } => {
                for v in self.voices.iter_mut().filter(|v| v.channel == channel && v.key == key) {
                    v.released = true;
                }
            }
        }
    }

    fn render(&mut self, left: &mut [f32], right: &mut [f32]) {
        let dt = 1.0 / self.sample_rate;
        let decay = (-dt / 1.4).exp(); // sustain decay, τ = 1.4 s
        let release = (-dt / 0.08).exp(); // release, τ = 80 ms
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            let mut s = 0.0;
            for v in &mut self.voices {
                let attack = (v.age / 0.004).min(1.0);
                let p = v.phase;
                s += v.amp * v.level * attack * (p.sin() + 0.4 * (2.0 * p).sin() + 0.15 * (3.0 * p).sin());
                v.phase = (p + v.step) % std::f32::consts::TAU;
                v.age += dt;
                v.level *= if v.released { release } else { decay };
            }
            let out = (s * self.gain).tanh();
            *l = out;
            *r = out;
        }
        self.voices.retain(|v| v.level > 1e-4);
    }

    fn set_volume(&mut self, volume: f32) {
        self.gain = volume.clamp(0.0, 1.0) / DEFAULT_VOLUME;
    }
}

// --- Engine shared between the audio thread and the commands ---------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SynthKind {
    Soundfont,
    Fallback,
    None,
}

/// MIDI channel for notes played live on the on-screen keyboard (not 9: drums).
pub const LIVE_CHANNEL: u8 = 10;

pub struct Engine {
    pub transport: Transport,
    pub follow: Follow,
    pub timed: Timed,
    /// Hands the transport played before "A tempo" mode took them over.
    hands_before_timed: Option<crate::playback::Hands>,
    synth: Option<Box<dyn Synth>>,
    actions: Vec<MidiAction>,
    left: Vec<f32>,
    right: Vec<f32>,
}

impl Engine {
    fn new(synth: Option<Box<dyn Synth>>) -> Self {
        Self {
            transport: Transport::new(),
            follow: Follow::default(),
            timed: Timed::default(),
            hands_before_timed: None,
            synth,
            actions: Vec::with_capacity(128),
            left: vec![0.0; BLOCK_FRAMES],
            right: vec![0.0; BLOCK_FRAMES],
        }
    }

    /// Run a transport operation and send the actions it produces to the synth.
    pub fn with_transport<R>(&mut self, f: impl FnOnce(&mut Transport, &mut Vec<MidiAction>) -> R) -> R {
        self.actions.clear();
        let result = f(&mut self.transport, &mut self.actions);
        self.flush();
        result
    }

    pub fn set_volume(&mut self, volume: f32) {
        if let Some(s) = self.synth.as_mut() {
            s.set_volume(volume);
        }
    }

    pub fn set_reverb(&mut self, amount: f32) {
        if let Some(s) = self.synth.as_mut() {
            s.set_reverb(amount);
        }
    }

    /// Transpose playback, follow and "A tempo" modes by `semitones`.
    pub fn set_transpose(&mut self, semitones: i8) {
        self.with_transport(|t, out| t.set_transpose(semitones, out));
        self.follow.set_transpose(semitones);
        self.timed.set_transpose(semitones);
    }

    /// "A tempo" mode: the player plays `hands` (the transport's hands setting),
    /// the app plays the other hand, or nothing when both are practised; the
    /// music starts after the count-in. Leaves follow mode.
    pub fn start_timed(&mut self, tolerance_ms: f64, count_in: Option<(u32, f64)>) {
        self.follow.stop();
        let practised = self.transport.hands();
        let rate = self.transport.rate();
        self.with_transport(|t, out| {
            t.pause(out);
            if t.position_ms() >= t.duration_ms() {
                t.seek(0.0, out);
            }
        });
        let from = self.transport.position_ms();
        self.timed.set_hands(practised);
        self.timed.start(from, tolerance_ms, rate);
        self.hands_before_timed = Some(practised);
        self.with_transport(|t, out| {
            use crate::playback::Hands;
            match practised {
                Hands::Both => t.set_silent(true, out),
                Hands::Right => t.set_hands(Hands::Left, out),
                Hands::Left => t.set_hands(Hands::Right, out),
            }
            match count_in {
                Some((beats, beat_ms)) => t.play_with_count_in(beats, beat_ms),
                None => t.play(),
            }
        });
    }

    /// Leave "A tempo" mode: the transport stops and plays every hand again.
    pub fn stop_timed(&mut self) -> Option<TimedSummary> {
        let summary = self.timed.stop();
        if let Some(hands) = self.hands_before_timed.take() {
            self.with_transport(|t, out| {
                t.pause(out);
                t.set_silent(false, out);
                t.set_hands(hands, out);
            });
        }
        summary
    }

    /// Sound a note played live (on-screen keyboard), outside the transport.
    pub fn play_live(&mut self, key: u8, velocity: u8, on: bool) {
        if let Some(synth) = self.synth.as_mut() {
            synth.apply(if on {
                MidiAction::NoteOn { channel: LIVE_CHANNEL, key, velocity }
            } else {
                MidiAction::NoteOff { channel: LIVE_CHANNEL, key }
            });
        }
    }

    /// Feed a played note to follow mode and keep the transport on the expected chord.
    pub fn follow_note(&mut self, pitch: u8) -> Vec<crate::follow::MeasureResult> {
        let results = self.follow.note_on(pitch);
        if let Some(ms) = self.follow.current_onset() {
            self.with_transport(|t, out| t.seek(ms, out));
        }
        results
    }

    fn flush(&mut self) {
        if let Some(synth) = self.synth.as_mut() {
            for a in self.actions.drain(..) {
                synth.apply(a);
            }
        } else {
            self.actions.clear();
        }
    }

    /// Audio callback body: fill an interleaved buffer.
    fn process(&mut self, data: &mut [f32], channels: usize, sample_rate: u32) {
        let block_ms = 1000.0 / sample_rate as f64;
        for chunk in data.chunks_mut(BLOCK_FRAMES * channels) {
            let frames = chunk.len() / channels;
            self.actions.clear();
            self.transport.advance(frames as f64 * block_ms, &mut self.actions);
            self.flush();
            let (l, r) = (&mut self.left[..frames], &mut self.right[..frames]);
            match self.synth.as_mut() {
                Some(s) => s.render(l, r),
                None => {
                    l.fill(0.0);
                    r.fill(0.0);
                }
            }
            for (i, frame) in chunk.chunks_mut(channels).enumerate() {
                for (c, sample) in frame.iter_mut().enumerate() {
                    *sample = if c % 2 == 0 { self.left[i] } else { self.right[i] };
                }
            }
        }
    }
}

pub type SharedEngine = Arc<Mutex<Engine>>;

pub struct AudioStatus {
    pub kind: SynthKind,
    pub soundfont: Option<PathBuf>,
}

/// Start audio output (or the silent clock) and return the shared engine.
pub fn start(soundfont: Option<PathBuf>) -> (SharedEngine, AudioStatus) {
    let (tx, rx) = std::sync::mpsc::channel();
    // cpal streams are not Send on macOS: build and keep the stream on its own thread.
    thread::Builder::new()
        .name("audio".into())
        .spawn(move || match open_output(soundfont.as_deref()) {
            Ok((engine, status, stream)) => {
                let _ = tx.send((engine, status));
                let _keep_alive = stream;
                loop {
                    thread::park();
                }
            }
            Err(e) => {
                log::warn!("audio output unavailable, using a silent clock: {e}");
                let engine = Arc::new(Mutex::new(Engine::new(None)));
                let _ = tx.send((engine.clone(), AudioStatus { kind: SynthKind::None, soundfont: None }));
                run_silent_clock(engine);
            }
        })
        .expect("spawn audio thread");
    rx.recv().expect("audio thread reports its status")
}

fn open_output(soundfont: Option<&Path>) -> Result<(SharedEngine, AudioStatus, cpal::Stream), String> {
    let device = cpal::default_host().default_output_device().ok_or("no output device")?;
    let supported = device.default_output_config().map_err(|e| e.to_string())?;
    if supported.sample_format() != cpal::SampleFormat::F32 {
        return Err(format!("unsupported sample format {:?}", supported.sample_format()));
    }
    let config: cpal::StreamConfig = supported.into();
    let (sample_rate, channels) = (config.sample_rate.0, config.channels as usize);

    let (synth, status): (Box<dyn Synth>, AudioStatus) =
        match soundfont.map(|p| (p, SoundFontSynth::load(p, sample_rate))) {
            Some((path, Ok(s))) => {
                log::info!("SoundFont loaded: {}", path.display());
                (Box::new(s), AudioStatus { kind: SynthKind::Soundfont, soundfont: Some(path.to_path_buf()) })
            }
            other => {
                if let Some((_, Err(e))) = other {
                    log::warn!("SoundFont not usable, falling back: {e}");
                }
                (Box::new(FallbackSynth::new(sample_rate)), AudioStatus { kind: SynthKind::Fallback, soundfont: None })
            }
        };

    let mut synth = synth;
    synth.set_volume(DEFAULT_VOLUME);
    synth.set_reverb(DEFAULT_REVERB);
    let engine = Arc::new(Mutex::new(Engine::new(Some(synth))));
    let cb_engine = engine.clone();
    let stream = device
        .build_output_stream(
            &config,
            move |data: &mut [f32], _| match cb_engine.lock() {
                Ok(mut e) => e.process(data, channels, sample_rate),
                Err(_) => data.fill(0.0),
            },
            |err| log::error!("audio stream error: {err}"),
            None,
        )
        .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    Ok((engine, status, stream))
}

fn run_silent_clock(engine: SharedEngine) -> ! {
    let mut last = Instant::now();
    loop {
        thread::sleep(Duration::from_millis(5));
        let now = Instant::now();
        let ms = now.duration_since(last).as_secs_f64() * 1000.0;
        last = now;
        if let Ok(mut e) = engine.lock() {
            e.with_transport(|t, out| t.advance(ms, out));
        }
    }
}

/// Look for a piano SoundFont: `$SCORE_STUDIO_SOUNDFONT`, then the first `.sf2`
/// in each of `dirs` (in order).
pub fn find_soundfont(dirs: &[PathBuf]) -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("SCORE_STUDIO_SOUNDFONT").map(PathBuf::from) {
        if p.is_file() {
            return Some(p);
        }
        log::warn!("SCORE_STUDIO_SOUNDFONT points to a missing file: {}", p.display());
    }
    dirs.iter().find_map(|dir| {
        let mut sf2: Vec<PathBuf> = std::fs::read_dir(dir)
            .ok()?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("sf2")))
            .collect();
        sf2.sort();
        sf2.into_iter().next()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::playback::PlaybackEvent;

    #[test]
    fn fallback_synth_sounds_and_decays_after_release() {
        let mut s = FallbackSynth::new(44_100);
        let (mut l, mut r) = (vec![0.0; 512], vec![0.0; 512]);
        s.apply(MidiAction::NoteOn { channel: 0, key: 69, velocity: 100 });
        s.render(&mut l, &mut r);
        assert!(l.iter().any(|x| x.abs() > 0.01));
        s.apply(MidiAction::NoteOff { channel: 0, key: 69 });
        for _ in 0..200 {
            s.render(&mut l, &mut r);
        }
        assert!(s.voices.is_empty());
    }

    /// Run with a real SoundFont: `scripts/fetch-soundfont.sh && cargo test -- --ignored`.
    #[test]
    #[ignore = "needs a .sf2 in resources/"]
    fn soundfont_synth_renders_a_piano_note() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let path = find_soundfont(&[dir]).expect("no .sf2 in resources/");
        let mut s = SoundFontSynth::load(&path, 44_100).unwrap();
        s.apply(MidiAction::NoteOn { channel: 0, key: 60, velocity: 100 });
        let (mut l, mut r) = (vec![0.0; 4410], vec![0.0; 4410]);
        s.render(&mut l, &mut r);
        assert!(l.iter().any(|x| x.abs() > 0.01));
    }

    #[test]
    fn timed_mode_plays_the_other_hand_and_restores_after() {
        use crate::playback::Hands;
        let ev = |id: &str, pitch, staff| PlaybackEvent {
            note_id: id.to_string(),
            pitch,
            onset_ms: 0.0,
            dur_ms: 500.0,
            velocity: 80,
            staff,
            measure: 1,
        };
        let events = vec![ev("r", 72, 1), ev("l", 48, 2)];
        let mut e = Engine::new(None);
        e.timed.load(&events);
        e.with_transport(|t, out| {
            t.load(events, out);
            t.set_hands(Hands::Right, out);
        });
        e.start_timed(100.0, Some((4, 500.0)));
        assert!(e.timed.is_active() && e.transport.is_playing() && e.transport.counting_in());
        assert_eq!(e.transport.hands(), Hands::Left, "the app accompanies with the left hand");
        let summary = e.stop_timed().expect("was running");
        assert_eq!(summary.expected, 0, "nothing judged before the music started");
        assert_eq!(e.transport.hands(), Hands::Right);
        assert!(!e.transport.is_playing());
    }

    #[test]
    fn follow_note_keeps_transport_on_the_expected_chord() {
        let ev = |id: &str, pitch, onset| PlaybackEvent {
            note_id: id.to_string(),
            pitch,
            onset_ms: onset,
            dur_ms: 500.0,
            velocity: 80,
            staff: 1,
            measure: 1,
        };
        let events = vec![ev("a", 60, 0.0), ev("b", 62, 500.0)];
        let mut e = Engine::new(None);
        e.follow.load(&events);
        e.with_transport(|t, out| t.load(events, out));
        e.follow.start(0.0);
        e.follow_note(61); // wrong: stays
        assert_eq!(e.transport.position_ms(), 0.0);
        e.follow_note(60);
        assert_eq!(e.transport.position_ms(), 500.0);
        assert!(!e.transport.is_playing(), "follow mode never starts the clock");
    }

    #[test]
    fn engine_process_advances_transport_by_buffer_length() {
        let mut e = Engine::new(Some(Box::new(FallbackSynth::new(48_000))));
        e.with_transport(|t, out| {
            t.load(
                vec![PlaybackEvent {
                    note_id: "n".into(),
                    pitch: 60,
                    onset_ms: 0.0,
                    dur_ms: 2000.0,
                    velocity: 90,
                    staff: 1,
                    measure: 1,
                }],
                out,
            );
            t.play();
        });
        let mut buf = vec![0.0f32; 480 * 2]; // 10 ms stereo at 48 kHz
        e.process(&mut buf, 2, 48_000);
        assert!((e.transport.position_ms() - 10.0).abs() < 1e-9);
        assert!(buf.iter().any(|x| x.abs() > 0.0));
    }
}
