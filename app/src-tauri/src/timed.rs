//! "A tempo" mode: the music goes on at the chosen tempo whatever the player
//! does, as in real sight-reading, and every note is judged against the clock.
//!
//! Pure state machine (no MIDI, no clock), like [`crate::follow`]:
//! - `note_on(pitch, position)`: the played key is matched to the nearest
//!   expected note of that pitch not yet played: on time (within `tolerance`),
//!   early or late (within `window`), or wrong;
//! - `tick(position)`: notes whose window has passed are missed; a measure is
//!   reported once all its notes are decided and the music has left it.
//!
//! Times are score milliseconds; the engine converts the tolerance from real
//! time with the tempo factor, so a slower tempo is not judged more strictly.

use serde::Serialize;

use crate::playback::{transposed, Hands, Loop, PlaybackEvent};

/// How far from its time a note still counts, as a multiple of the tolerance.
const WINDOW_FACTOR: f64 = 2.5;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    Pending,
    Played,
    Missed,
}

#[derive(Debug, Clone)]
struct Expected {
    onset_ms: f64,
    pitch: u8,
    measure: u32,
    state: State,
}

/// What happened in one measure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
pub struct TimedResult {
    pub measure: u32,
    pub correct: u32,
    pub early: u32,
    pub late: u32,
    pub wrong: u32,
    pub missed: u32,
}

impl TimedResult {
    fn add(&mut self, other: &TimedResult) {
        self.correct += other.correct;
        self.early += other.early;
        self.late += other.late;
        self.wrong += other.wrong;
        self.missed += other.missed;
    }
}

/// The verdict on one expected note, for drills that show it note by note.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteJudgement {
    /// Onset of the expected note (score ms): identifies it.
    pub onset_ms: f64,
    /// "correct", "early", "late" or "missed".
    pub verdict: &'static str,
    /// How far from its time it was played, in real ms (0 when missed).
    pub offset_ms: f64,
}

/// Totals of a run, sent when the music ends or the player stops.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TimedSummary {
    pub correct: u32,
    pub early: u32,
    pub late: u32,
    pub wrong: u32,
    pub missed: u32,
    /// Notes the score asked for in the part played.
    pub expected: u32,
    /// Mean timing of the notes hit, in real milliseconds (negative = ahead).
    pub mean_offset_ms: f64,
    pub measures: u32,
}

#[derive(Debug, Default)]
pub struct Timed {
    events: Vec<PlaybackEvent>,
    expected: Vec<Expected>,
    active: bool,
    hands: Hands,
    transpose: i8,
    loop_range: Option<Loop>,
    /// On-time tolerance in score ms (from real ms and the tempo factor).
    tolerance: f64,
    rate: f64,
    /// Results being collected, by measure.
    open: Vec<TimedResult>,
    total: TimedResult,
    measures_done: u32,
    offsets_ms: Vec<f64>,
    last_position: f64,
    /// Rhythm drills: any key counts, only the timing is judged.
    any_key: bool,
    judged: Vec<NoteJudgement>,
}

impl Timed {
    pub fn load(&mut self, events: &[PlaybackEvent]) {
        self.events = events.to_vec();
        self.events.sort_by(|a, b| a.onset_ms.total_cmp(&b.onset_ms));
        self.stop();
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    pub fn set_hands(&mut self, hands: Hands) {
        self.hands = hands;
    }

    pub fn set_transpose(&mut self, semitones: i8) {
        self.transpose = semitones;
    }

    pub fn set_loop(&mut self, range: Option<Loop>) {
        self.loop_range = range;
    }

    /// Start judging from `from_ms`, with an on-time tolerance of `tolerance_real_ms`
    /// at tempo factor `rate`.
    #[cfg(test)]
    pub fn start(&mut self, from_ms: f64, tolerance_real_ms: f64, rate: f64) {
        self.start_with(from_ms, tolerance_real_ms, rate, false);
    }

    /// As [`Timed::start`]; with `any_key` every key counts for any note (rhythm only).
    pub fn start_with(&mut self, from_ms: f64, tolerance_real_ms: f64, rate: f64, any_key: bool) {
        self.any_key = any_key;
        self.judged.clear();
        self.active = true;
        self.rate = rate.max(0.01);
        self.tolerance = tolerance_real_ms.max(10.0) * self.rate;
        self.total = TimedResult::default();
        self.measures_done = 0;
        self.offsets_ms.clear();
        self.open.clear();
        self.last_position = from_ms;
        self.fill(from_ms, f64::INFINITY);
    }

    /// Stop judging; returns the totals of the run (None if it was not running).
    pub fn stop(&mut self) -> Option<TimedSummary> {
        let summary = self.active.then(|| self.summary());
        self.active = false;
        self.expected.clear();
        self.open.clear();
        summary
    }

    fn fill(&mut self, from_ms: f64, to_ms: f64) {
        let lo = from_ms - 1.0;
        self.expected.retain(|e| e.onset_ms < lo || e.onset_ms >= to_ms);
        for e in &self.events {
            if e.onset_ms < lo || e.onset_ms >= to_ms || !self.hands.plays(e.staff) {
                continue;
            }
            if let Some(range) = self.loop_range {
                if e.onset_ms < range.start_ms || e.onset_ms >= range.end_ms {
                    continue;
                }
            }
            if let Some(pitch) = transposed(e.pitch, self.transpose) {
                self.expected.push(Expected { onset_ms: e.onset_ms, pitch, measure: e.measure, state: State::Pending });
            }
        }
        self.expected.sort_by(|a, b| a.onset_ms.total_cmp(&b.onset_ms));
    }

    fn window(&self) -> f64 {
        self.tolerance * WINDOW_FACTOR
    }

    fn result_for(&mut self, measure: u32) -> &mut TimedResult {
        if let Some(i) = self.open.iter().position(|r| r.measure == measure) {
            return &mut self.open[i];
        }
        self.open.push(TimedResult { measure, ..Default::default() });
        self.open.last_mut().expect("just pushed")
    }

    /// Measure at `position`: the last expected note at or before it, else the first.
    fn measure_at(&self, position: f64) -> u32 {
        self.expected
            .iter()
            .rev()
            .find(|e| e.onset_ms <= position)
            .or_else(|| self.expected.first())
            .map_or(0, |e| e.measure)
    }

    /// The player pressed `pitch` while the music was at `position` (score ms).
    pub fn note_on(&mut self, pitch: u8, position: f64) {
        if !self.active {
            return;
        }
        let window = self.window();
        let best = self
            .expected
            .iter()
            .enumerate()
            .filter(|(_, e)| e.state == State::Pending && (self.any_key || e.pitch == pitch))
            .filter(|(_, e)| (e.onset_ms - position).abs() <= window)
            .min_by(|(_, a), (_, b)| (a.onset_ms - position).abs().total_cmp(&(b.onset_ms - position).abs()))
            .map(|(i, _)| i);
        match best {
            Some(i) => {
                let (onset, measure) = (self.expected[i].onset_ms, self.expected[i].measure);
                self.expected[i].state = State::Played;
                let offset = position - onset;
                self.offsets_ms.push(offset / self.rate);
                let tolerance = self.tolerance;
                let verdict = if offset.abs() <= tolerance {
                    "correct"
                } else if offset < 0.0 {
                    "early"
                } else {
                    "late"
                };
                self.judged.push(NoteJudgement { onset_ms: onset, verdict, offset_ms: offset / self.rate });
                let r = self.result_for(measure);
                match verdict {
                    "correct" => r.correct += 1,
                    "early" => r.early += 1,
                    _ => r.late += 1,
                }
            }
            None => {
                let measure = self.measure_at(position);
                self.result_for(measure).wrong += 1;
            }
        }
    }

    /// The music is at `position`: mark missed notes and return the measures finished.
    pub fn tick(&mut self, position: f64) -> Vec<TimedResult> {
        if !self.active {
            return Vec::new();
        }
        // A loop wrapped: the notes of the loop can be played again.
        if position + 1.0 < self.last_position {
            if let Some(range) = self.loop_range {
                self.fill(range.start_ms, range.end_ms);
            }
        }
        self.last_position = position;
        let window = self.window();
        let mut missed: Vec<u32> = Vec::new();
        for e in &mut self.expected {
            if e.state == State::Pending && e.onset_ms + window < position {
                e.state = State::Missed;
                missed.push(e.measure);
                self.judged.push(NoteJudgement { onset_ms: e.onset_ms, verdict: "missed", offset_ms: 0.0 });
            }
        }
        for m in missed {
            self.result_for(m).missed += 1;
        }
        // A measure is finished when none of its notes is still pending.
        let mut done = Vec::new();
        let mut i = 0;
        while i < self.open.len() {
            let m = self.open[i].measure;
            let pending = self.expected.iter().any(|e| e.measure == m && e.state == State::Pending);
            let left = self.expected.iter().filter(|e| e.measure == m).all(|e| e.onset_ms + window < position);
            if !pending && left {
                let r = self.open.remove(i);
                self.total.add(&r);
                self.measures_done += 1;
                done.push(r);
            } else {
                i += 1;
            }
        }
        done
    }

    /// Note verdicts since the last call (chords give one per note).
    pub fn drain_judged(&mut self) -> Vec<NoteJudgement> {
        std::mem::take(&mut self.judged)
    }

    fn summary(&self) -> TimedSummary {
        let mut total = self.total;
        for r in &self.open {
            total.add(r);
        }
        let mean = if self.offsets_ms.is_empty() {
            0.0
        } else {
            self.offsets_ms.iter().sum::<f64>() / self.offsets_ms.len() as f64
        };
        TimedSummary {
            correct: total.correct,
            early: total.early,
            late: total.late,
            wrong: total.wrong,
            missed: total.missed,
            expected: total.correct + total.early + total.late + total.missed,
            mean_offset_ms: mean,
            measures: self.measures_done + self.open.len() as u32,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(pitch: u8, onset: f64, measure: u32, staff: u8) -> PlaybackEvent {
        PlaybackEvent {
            note_id: format!("n{pitch}-{onset}"),
            pitch,
            onset_ms: onset,
            dur_ms: 400.0,
            velocity: 80,
            staff,
            measure,
        }
    }

    /// Measure 1: C4 at 0, E4 at 500; measure 2: G4 at 1000 (right hand), C3 at 1000 (left).
    fn timed() -> Timed {
        let mut t = Timed::default();
        t.load(&[ev(60, 0.0, 1, 1), ev(64, 500.0, 1, 1), ev(67, 1000.0, 2, 1), ev(48, 1000.0, 2, 2)]);
        t
    }

    #[test]
    fn judges_each_note_against_the_clock() {
        let mut t = timed();
        t.start(0.0, 100.0, 1.0);
        t.note_on(60, 30.0); // on time
        t.note_on(64, 650.0); // 150 ms late
        t.note_on(61, 700.0); // wrong key
        let results = t.tick(1000.0);
        assert_eq!(results, vec![TimedResult { measure: 1, correct: 1, early: 0, late: 1, wrong: 1, missed: 0 }]);
        t.note_on(67, 880.0 + 0.0); // 120 ms early
                                    // C3 never played: missed once its window passes.
        let results = t.tick(1300.0);
        assert_eq!(results, vec![TimedResult { measure: 2, correct: 0, early: 1, late: 0, wrong: 0, missed: 1 }]);
        let s = t.stop().expect("was running");
        assert_eq!((s.correct, s.early, s.late, s.wrong, s.missed, s.expected), (1, 1, 1, 1, 1, 4));
        assert_eq!(s.measures, 2);
        assert!((s.mean_offset_ms - (30.0 + 150.0 - 120.0) / 3.0).abs() < 1e-9);
    }

    #[test]
    fn tolerance_follows_the_tempo() {
        let mut t = timed();
        // Half speed: 100 real ms are 50 score ms; a note 80 score ms off is late.
        t.start(0.0, 100.0, 0.5);
        t.note_on(60, 80.0);
        t.tick(2000.0);
        let s = t.stop().expect("running");
        assert_eq!((s.correct, s.late), (0, 1));
        assert!((s.mean_offset_ms - 160.0).abs() < 1e-9, "reported in real ms");
    }

    #[test]
    fn only_the_hands_practised_are_expected() {
        let mut t = timed();
        t.set_hands(Hands::Left);
        t.start(0.0, 100.0, 1.0);
        t.note_on(48, 1000.0);
        t.tick(2000.0);
        let s = t.stop().expect("running");
        assert_eq!((s.correct, s.missed, s.expected), (1, 0, 1));
    }

    #[test]
    fn starting_mid_piece_ignores_earlier_notes() {
        let mut t = timed();
        t.start(1000.0, 100.0, 1.0);
        t.tick(1500.0);
        let s = t.stop().expect("running");
        assert_eq!(s.expected, 2, "only measure 2");
    }

    #[test]
    fn transposed_practice_expects_transposed_keys() {
        let mut t = timed();
        t.set_transpose(2);
        t.start(0.0, 100.0, 1.0);
        t.note_on(62, 0.0);
        t.note_on(60, 500.0); // the written pitch is wrong when transposed
        t.tick(600.0);
        let s = t.stop().expect("running");
        assert_eq!((s.correct, s.wrong), (1, 1));
    }

    #[test]
    fn loop_wraps_and_measures_count_again() {
        let mut t = timed();
        t.set_loop(Some(Loop { start_ms: 0.0, end_ms: 1000.0 }));
        t.start(0.0, 100.0, 1.0);
        t.note_on(60, 0.0);
        t.note_on(64, 500.0);
        assert_eq!(t.tick(999.0).len(), 1);
        t.tick(10.0); // wrapped
        t.note_on(60, 20.0);
        t.note_on(64, 520.0);
        assert_eq!(t.tick(999.0)[0].correct, 2);
        assert_eq!(t.stop().expect("running").correct, 4);
    }

    #[test]
    fn any_key_judges_only_the_timing() {
        let mut t = timed();
        t.start_with(0.0, 100.0, 1.0, true);
        t.note_on(30, 10.0); // C4 expected: any key is fine
        t.note_on(99, 640.0); // E4 expected at 500: late
        let judged = t.drain_judged();
        assert_eq!(judged.iter().map(|j| j.verdict).collect::<Vec<_>>(), vec!["correct", "late"]);
        assert_eq!(judged[1].onset_ms, 500.0);
        t.tick(5000.0);
        let missed = t.drain_judged();
        assert_eq!(missed.len(), 2, "G4 and C3 never played");
        assert!(missed.iter().all(|j| j.verdict == "missed"));
        assert!(t.drain_judged().is_empty());
    }

    #[test]
    fn inactive_mode_ignores_everything() {
        let mut t = timed();
        t.note_on(60, 0.0);
        assert!(t.tick(5000.0).is_empty());
        assert!(t.stop().is_none());
    }
}
