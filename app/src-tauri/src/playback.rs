//! Playback scheduler and clock.
//!
//! [`Transport`] is a pure state machine: given the elapsed real time it
//! returns the MIDI actions due in that window. The audio callback drives it
//! in sub-blocks of [`crate::synth::BLOCK_FRAMES`] frames (≈ 1.5 ms at
//! 44.1 kHz) right before rendering them, so every note lands in the audio
//! buffer it belongs to: the look-ahead is the output buffer itself
//! (typically 5–20 ms), with no second thread and no timer jitter. When no
//! audio device is available a wall-clock thread drives it instead.
//!
//! All positions are in *score* milliseconds (at 100 % tempo); the tempo
//! factor only scales how fast real time advances the score position.

use serde::Deserialize;

/// One note to play, built by the frontend from Verovio's timemap.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackEvent {
    pub note_id: String,
    pub pitch: u8,
    pub onset_ms: f64,
    pub dur_ms: f64,
    pub velocity: u8,
    /// 1-based staff: 1 = right hand, 2 = left hand on a piano grand staff.
    pub staff: u8,
    /// 1-based measure index in performance order (0 when unknown).
    #[serde(default)]
    pub measure: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Hands {
    #[default]
    Both,
    Right,
    Left,
}

impl Hands {
    pub fn plays(self, staff: u8) -> bool {
        match self {
            Hands::Both => true,
            Hands::Right => staff <= 1,
            Hands::Left => staff >= 2,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Loop {
    pub start_ms: f64,
    pub end_ms: f64,
}

/// Shortest loop accepted, in score milliseconds.
pub const MIN_LOOP_MS: f64 = 50.0;
pub const MIN_TEMPO: f64 = 0.25;
pub const MAX_TEMPO: f64 = 2.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MidiAction {
    NoteOn { channel: u8, key: u8, velocity: u8 },
    NoteOff { channel: u8, key: u8 },
}

/// Staff → MIDI channel. Channel 9 (drums in General MIDI) is never used.
fn channel_for_staff(staff: u8) -> u8 {
    staff.saturating_sub(1).min(8)
}

#[derive(Debug, Clone, Copy)]
struct Sounding {
    off_ms: f64,
    channel: u8,
    key: u8,
}

#[derive(Debug)]
pub struct Transport {
    events: Vec<PlaybackEvent>,
    duration_ms: f64,
    max_dur_ms: f64,
    position_ms: f64,
    rate: f64,
    playing: bool,
    loop_range: Option<Loop>,
    hands: Hands,
    /// Index of the next event whose onset has not been dispatched yet.
    next: usize,
    sounding: Vec<Sounding>,
}

impl Default for Transport {
    fn default() -> Self {
        Self::new()
    }
}

impl Transport {
    pub fn new() -> Self {
        Self {
            events: Vec::new(),
            duration_ms: 0.0,
            max_dur_ms: 0.0,
            position_ms: 0.0,
            rate: 1.0,
            playing: false,
            loop_range: None,
            hands: Hands::Both,
            next: 0,
            sounding: Vec::with_capacity(64),
        }
    }

    /// Replace the score. Stops playback and rewinds.
    pub fn load(&mut self, mut events: Vec<PlaybackEvent>, out: &mut Vec<MidiAction>) {
        self.release_all(out);
        events.retain(|e| e.dur_ms > 0.0 && e.onset_ms >= 0.0 && e.pitch <= 127);
        events.sort_by(|a, b| a.onset_ms.total_cmp(&b.onset_ms).then(a.pitch.cmp(&b.pitch)));
        self.duration_ms = events.iter().map(|e| e.onset_ms + e.dur_ms).fold(0.0, f64::max);
        self.max_dur_ms = events.iter().map(|e| e.dur_ms).fold(0.0, f64::max);
        self.events = events;
        self.playing = false;
        self.loop_range = None;
        self.position_ms = 0.0;
        self.next = 0;
    }

    pub fn duration_ms(&self) -> f64 {
        self.duration_ms
    }

    pub fn position_ms(&self) -> f64 {
        self.position_ms
    }

    pub fn is_playing(&self) -> bool {
        self.playing
    }

    pub fn play(&mut self) {
        if self.events.is_empty() {
            return;
        }
        if self.position_ms >= self.duration_ms {
            let start = self.loop_range.map_or(0.0, |l| l.start_ms);
            self.position_ms = start;
            self.next = self.first_event_at(start);
        }
        self.playing = true;
    }

    pub fn pause(&mut self, out: &mut Vec<MidiAction>) {
        self.playing = false;
        self.release_all(out);
    }

    pub fn seek(&mut self, ms: f64, out: &mut Vec<MidiAction>) {
        self.release_all(out);
        self.position_ms = ms.clamp(0.0, self.duration_ms);
        self.next = self.first_event_at(self.position_ms);
    }

    /// Tempo factor: 1.0 = as written, 0.5 = half speed.
    pub fn set_rate(&mut self, rate: f64) {
        self.rate = rate.clamp(MIN_TEMPO, MAX_TEMPO);
    }

    /// Set or clear the A–B loop. Loops shorter than [`MIN_LOOP_MS`] are ignored.
    pub fn set_loop(&mut self, range: Option<Loop>) {
        self.loop_range = range
            .map(|l| Loop {
                start_ms: l.start_ms.clamp(0.0, self.duration_ms),
                end_ms: l.end_ms.clamp(0.0, self.duration_ms),
            })
            .filter(|l| l.end_ms - l.start_ms >= MIN_LOOP_MS);
    }

    pub fn set_hands(&mut self, hands: Hands, out: &mut Vec<MidiAction>) {
        if hands != self.hands {
            self.release_all(out);
            self.hands = hands;
        }
    }

    /// Advance by `real_ms` of wall-clock time, pushing the MIDI actions due.
    /// Returns true when playback reached the end of the score in this call.
    pub fn advance(&mut self, real_ms: f64, out: &mut Vec<MidiAction>) -> bool {
        if !self.playing || real_ms <= 0.0 {
            return false;
        }
        let mut remaining = real_ms * self.rate;
        loop {
            let looping = self.loop_range.filter(|l| self.position_ms < l.end_ms);
            let boundary = looping.map_or(self.duration_ms, |l| l.end_ms);
            let target = self.position_ms + remaining;
            if target < boundary {
                self.dispatch_until(target, out);
                self.position_ms = target;
                return false;
            }
            self.dispatch_until(boundary, out);
            remaining = target - boundary;
            self.release_all(out);
            match looping {
                Some(l) => {
                    self.position_ms = l.start_ms;
                    self.next = self.first_event_at(l.start_ms);
                }
                None => {
                    self.position_ms = self.duration_ms;
                    self.next = self.events.len();
                    self.playing = false;
                    return true;
                }
            }
        }
    }

    /// IDs of the notes sounding at the current position (for the cursor).
    pub fn current_note_ids(&self) -> Vec<String> {
        let pos = self.position_ms;
        let hi = self.events.partition_point(|e| e.onset_ms <= pos);
        let mut ids: Vec<String> = self.events[..hi]
            .iter()
            .rev()
            .take_while(|e| e.onset_ms > pos - self.max_dur_ms - 1.0)
            .filter(|e| pos < e.onset_ms + e.dur_ms)
            .map(|e| e.note_id.clone())
            .collect();
        ids.reverse();
        ids
    }

    fn first_event_at(&self, ms: f64) -> usize {
        self.events.partition_point(|e| e.onset_ms < ms)
    }

    fn dispatch_until(&mut self, until_ms: f64, out: &mut Vec<MidiAction>) {
        // Note-offs first, so a repeated pitch is released before it restarts.
        self.sounding.retain(|s| {
            let done = s.off_ms <= until_ms;
            if done {
                out.push(MidiAction::NoteOff { channel: s.channel, key: s.key });
            }
            !done
        });
        while let Some(e) = self.events.get(self.next) {
            if e.onset_ms >= until_ms {
                break;
            }
            self.next += 1;
            if !self.hands.plays(e.staff) {
                continue;
            }
            let (channel, key) = (channel_for_staff(e.staff), e.pitch);
            if let Some(i) = self.sounding.iter().position(|s| s.channel == channel && s.key == key) {
                self.sounding.swap_remove(i);
                out.push(MidiAction::NoteOff { channel, key });
            }
            out.push(MidiAction::NoteOn { channel, key, velocity: e.velocity });
            self.sounding.push(Sounding { off_ms: e.onset_ms + e.dur_ms, channel, key });
        }
    }

    fn release_all(&mut self, out: &mut Vec<MidiAction>) {
        out.extend(self.sounding.drain(..).map(|s| MidiAction::NoteOff { channel: s.channel, key: s.key }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use MidiAction::*;

    fn ev(id: &str, pitch: u8, onset: f64, dur: f64, staff: u8) -> PlaybackEvent {
        PlaybackEvent { note_id: id.into(), pitch, onset_ms: onset, dur_ms: dur, velocity: 80, staff, measure: 1 }
    }

    /// Two beats at 120 bpm: right hand D5 then G4; left hand G3 held for both.
    fn transport() -> Transport {
        let mut t = Transport::new();
        let mut out = Vec::new();
        t.load(
            vec![ev("d5", 74, 0.0, 500.0, 1), ev("g3", 55, 0.0, 1000.0, 2), ev("g4", 67, 500.0, 500.0, 1)],
            &mut out,
        );
        t
    }

    fn on(key: u8, channel: u8) -> MidiAction {
        NoteOn { channel, key, velocity: 80 }
    }

    #[test]
    fn plays_notes_in_time_order() {
        let mut t = transport();
        let mut out = Vec::new();
        t.play();
        t.advance(10.0, &mut out);
        assert_eq!(out, vec![on(55, 1), on(74, 0)]);
        out.clear();
        t.advance(480.0, &mut out); // 490 ms: nothing due
        assert!(out.is_empty());
        t.advance(20.0, &mut out); // 510 ms: D5 off, G4 on
        assert_eq!(out, vec![NoteOff { channel: 0, key: 74 }, on(67, 0)]);
    }

    #[test]
    fn stops_at_the_end_and_releases_everything() {
        let mut t = transport();
        let mut out = Vec::new();
        t.play();
        assert!(t.advance(1500.0, &mut out));
        assert!(!t.is_playing());
        assert_eq!(t.position_ms(), 1000.0);
        let ons = out.iter().filter(|a| matches!(a, NoteOn { .. })).count();
        let offs = out.iter().filter(|a| matches!(a, NoteOff { .. })).count();
        assert_eq!((ons, offs), (3, 3));
        t.play(); // restarts from the top
        assert_eq!(t.position_ms(), 0.0);
    }

    #[test]
    fn tempo_scales_real_time() {
        let mut t = transport();
        let mut out = Vec::new();
        t.set_rate(0.5);
        t.play();
        t.advance(500.0, &mut out);
        assert_eq!(t.position_ms(), 250.0);
        t.set_rate(10.0); // clamped to 2.0
        t.advance(100.0, &mut out);
        assert_eq!(t.position_ms(), 450.0);
    }

    #[test]
    fn seek_releases_and_resumes_from_position() {
        let mut t = transport();
        let mut out = Vec::new();
        t.play();
        t.advance(10.0, &mut out);
        out.clear();
        t.seek(500.0, &mut out);
        assert_eq!(out.len(), 2, "both sounding notes released");
        out.clear();
        t.advance(1.0, &mut out);
        assert_eq!(out, vec![on(67, 0)], "only the note starting at the seek point");
    }

    #[test]
    fn loop_wraps_around() {
        let mut t = transport();
        let mut out = Vec::new();
        t.set_loop(Some(Loop { start_ms: 500.0, end_ms: 800.0 }));
        t.seek(500.0, &mut out);
        t.play();
        t.advance(400.0, &mut out); // 500 → 800 → wraps to 500, then +100
        assert!(t.is_playing());
        assert_eq!(t.position_ms(), 600.0);
        let g4_ons = out.iter().filter(|a| **a == on(67, 0)).count();
        assert_eq!(g4_ons, 2, "loop start note retriggered after the wrap");
    }

    #[test]
    fn tiny_loops_are_ignored() {
        let mut t = transport();
        t.set_loop(Some(Loop { start_ms: 100.0, end_ms: 120.0 }));
        let mut out = Vec::new();
        t.play();
        t.advance(2000.0, &mut out);
        assert!(!t.is_playing());
    }

    #[test]
    fn hands_filter_staves() {
        let mut t = transport();
        let mut out = Vec::new();
        t.set_hands(Hands::Left, &mut out);
        t.play();
        t.advance(2000.0, &mut out);
        let keys: Vec<u8> = out
            .iter()
            .filter_map(|a| match a {
                NoteOn { key, .. } => Some(*key),
                _ => None,
            })
            .collect();
        assert_eq!(keys, vec![55]);
    }

    #[test]
    fn repeated_pitch_is_released_before_retrigger() {
        let mut t = Transport::new();
        let mut out = Vec::new();
        // Overlapping notes on the same key (e.g. two voices on one staff).
        t.load(vec![ev("a", 60, 0.0, 600.0, 1), ev("b", 60, 500.0, 500.0, 1)], &mut out);
        t.play();
        t.advance(550.0, &mut out);
        assert_eq!(out, vec![on(60, 0), NoteOff { channel: 0, key: 60 }, on(60, 0)]);
    }

    #[test]
    fn cursor_reports_sounding_notes() {
        let mut t = transport();
        let mut out = Vec::new();
        assert_eq!(t.current_note_ids(), vec!["g3", "d5"]);
        t.seek(700.0, &mut out);
        assert_eq!(t.current_note_ids(), vec!["g3", "g4"]);
        t.seek(1000.0, &mut out);
        assert!(t.current_note_ids().is_empty());
    }
}
