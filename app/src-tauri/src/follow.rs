//! "Follow" (wait) mode: the cursor waits on each chord until every expected
//! note has been played, then moves on. Wrong notes are counted per measure
//! and reported as `follow:result {measure, correct, wrong}` when the cursor
//! leaves the measure.
//!
//! Pure state machine: no MIDI, no clock. Fed by `note_on` from the MIDI
//! input (or the on-screen keyboard).

use serde::Serialize;

use crate::playback::{Hands, Loop, PlaybackEvent};

/// Onsets closer than this are one chord (rolled or slightly offset notes).
const CHORD_TOLERANCE_MS: f64 = 15.0;

#[derive(Debug, Clone, PartialEq)]
struct Step {
    onset_ms: f64,
    measure: u32,
    pitches: Vec<u8>,
    note_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct MeasureResult {
    pub measure: u32,
    pub correct: u32,
    pub wrong: u32,
}

#[derive(Debug, Default)]
pub struct Follow {
    events: Vec<PlaybackEvent>,
    hands: Hands,
    steps: Vec<Step>,
    active: bool,
    idx: usize,
    /// Expected pitches of the current step already played.
    matched: Vec<u8>,
    current: Option<MeasureResult>,
    loop_range: Option<Loop>,
}

fn build_steps(events: &[PlaybackEvent], hands: Hands) -> Vec<Step> {
    let mut sorted: Vec<&PlaybackEvent> = events.iter().filter(|e| hands.plays(e.staff)).collect();
    sorted.sort_by(|a, b| a.onset_ms.total_cmp(&b.onset_ms));
    let mut steps: Vec<Step> = Vec::new();
    for e in sorted {
        match steps.last_mut() {
            Some(s) if e.onset_ms - s.onset_ms <= CHORD_TOLERANCE_MS => {
                if !s.pitches.contains(&e.pitch) {
                    s.pitches.push(e.pitch);
                }
                s.note_ids.push(e.note_id.clone());
            }
            _ => steps.push(Step {
                onset_ms: e.onset_ms,
                measure: e.measure,
                pitches: vec![e.pitch],
                note_ids: vec![e.note_id.clone()],
            }),
        }
    }
    steps
}

impl Follow {
    pub fn load(&mut self, events: &[PlaybackEvent]) {
        self.events = events.to_vec();
        self.steps = build_steps(&self.events, self.hands);
        self.loop_range = None;
        self.stop();
    }

    pub fn set_hands(&mut self, hands: Hands) {
        if hands == self.hands {
            return;
        }
        let at = self.current_onset();
        self.hands = hands;
        self.steps = build_steps(&self.events, hands);
        if let Some(ms) = at {
            self.seek(ms);
        }
    }

    pub fn set_loop(&mut self, range: Option<Loop>) {
        self.loop_range = range;
        if let (Some(l), Some(ms)) = (range, self.current_onset()) {
            if ms < l.start_ms || ms >= l.end_ms {
                self.seek(l.start_ms);
            }
        }
    }

    /// Start following from the first chord at or after `ms`.
    pub fn start(&mut self, ms: f64) {
        self.active = true;
        self.seek(ms);
    }

    pub fn stop(&mut self) {
        self.active = false;
        self.matched.clear();
        self.current = None;
    }

    /// Move to the first chord at or after `ms` (no result is reported for the measure left).
    pub fn seek(&mut self, ms: f64) {
        if !self.active {
            return;
        }
        self.idx = self.steps.partition_point(|s| s.onset_ms < ms - CHORD_TOLERANCE_MS);
        self.matched.clear();
        self.current = self.steps.get(self.idx).map(|s| MeasureResult { measure: s.measure, correct: 0, wrong: 0 });
        if self.idx >= self.steps.len() {
            self.active = false;
        }
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    pub fn current_onset(&self) -> Option<f64> {
        self.active.then(|| self.steps.get(self.idx).map(|s| s.onset_ms)).flatten()
    }

    /// Note IDs the player must play now.
    pub fn expected_note_ids(&self) -> Vec<String> {
        match (self.active, self.steps.get(self.idx)) {
            (true, Some(s)) => s.note_ids.clone(),
            _ => Vec::new(),
        }
    }

    /// Pitches the player must still play in the current chord.
    pub fn expected_pitches(&self) -> Vec<u8> {
        match (self.active, self.steps.get(self.idx)) {
            (true, Some(s)) => s.pitches.iter().copied().filter(|p| !self.matched.contains(p)).collect(),
            _ => Vec::new(),
        }
    }

    /// Handle a played note. Returns the results of the measures completed by it.
    pub fn note_on(&mut self, pitch: u8) -> Vec<MeasureResult> {
        let mut done = Vec::new();
        if !self.active {
            return done;
        }
        let Some(step) = self.steps.get(self.idx) else { return done };
        let Some(current) = self.current.as_mut() else { return done };
        if step.pitches.contains(&pitch) {
            if self.matched.contains(&pitch) {
                return done; // re-striking a note already played in this chord is neither right nor wrong
            }
            self.matched.push(pitch);
            current.correct += 1;
            if self.matched.len() == step.pitches.len() {
                self.advance(&mut done);
            }
        } else {
            current.wrong += 1;
        }
        done
    }

    fn advance(&mut self, done: &mut Vec<MeasureResult>) {
        self.matched.clear();
        self.idx += 1;
        let wrapped = match self.loop_range {
            Some(l) if self.steps.get(self.idx).is_none_or(|s| s.onset_ms >= l.end_ms) => {
                self.idx = self.steps.partition_point(|s| s.onset_ms < l.start_ms - CHORD_TOLERANCE_MS);
                true
            }
            _ => false,
        };
        let next = self.steps.get(self.idx);
        let measure_changed = wrapped || next.is_none_or(|s| Some(s.measure) != self.current.map(|c| c.measure));
        if measure_changed {
            done.extend(self.current.take());
            self.current = next.map(|s| MeasureResult { measure: s.measure, correct: 0, wrong: 0 });
        }
        if next.is_none() {
            self.active = false;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(id: &str, pitch: u8, onset: f64, staff: u8, measure: u32) -> PlaybackEvent {
        PlaybackEvent { note_id: id.into(), pitch, onset_ms: onset, dur_ms: 400.0, velocity: 80, staff, measure }
    }

    /// m1: [D5 + G3] then A4; m2: B4.
    fn follow() -> Follow {
        let mut f = Follow::default();
        f.load(&[
            ev("d5", 74, 0.0, 1, 1),
            ev("g3", 55, 0.0, 2, 1),
            ev("a4", 69, 500.0, 1, 1),
            ev("b4", 71, 1500.0, 1, 2),
        ]);
        f.start(0.0);
        f
    }

    #[test]
    fn waits_for_every_note_of_the_chord() {
        let mut f = follow();
        assert_eq!(f.expected_note_ids(), vec!["d5", "g3"]);
        f.note_on(74);
        assert_eq!(f.current_onset(), Some(0.0), "still waiting for G3");
        assert_eq!(f.expected_pitches(), vec![55]);
        f.note_on(55);
        assert_eq!(f.current_onset(), Some(500.0));
        assert_eq!(f.expected_note_ids(), vec!["a4"]);
    }

    #[test]
    fn wrong_notes_do_not_advance_and_are_counted_per_measure() {
        let mut f = follow();
        assert!(f.note_on(60).is_empty());
        assert_eq!(f.current_onset(), Some(0.0));
        f.note_on(74);
        f.note_on(74); // repeated right note: ignored
        f.note_on(55);
        let done = f.note_on(69);
        assert_eq!(done, vec![MeasureResult { measure: 1, correct: 3, wrong: 1 }]);
        assert_eq!(f.current_onset(), Some(1500.0));
        let done = f.note_on(71);
        assert_eq!(done, vec![MeasureResult { measure: 2, correct: 1, wrong: 0 }]);
        assert!(!f.is_active(), "finished at the end of the score");
        assert!(f.expected_note_ids().is_empty());
    }

    #[test]
    fn hands_select_the_staff_to_follow() {
        let mut f = follow();
        f.set_hands(Hands::Left);
        assert_eq!(f.expected_note_ids(), vec!["g3"]);
        f.note_on(55);
        assert!(!f.is_active(), "left hand has a single note");
    }

    #[test]
    fn loop_wraps_back_to_its_start() {
        let mut f = follow();
        f.set_loop(Some(Loop { start_ms: 500.0, end_ms: 1500.0 }));
        assert_eq!(f.current_onset(), Some(500.0), "moved inside the loop");
        let done = f.note_on(69);
        assert_eq!(done, vec![MeasureResult { measure: 1, correct: 1, wrong: 0 }]);
        assert_eq!(f.current_onset(), Some(500.0));
        assert!(f.is_active());
    }

    #[test]
    fn near_simultaneous_onsets_form_one_chord_and_seek_finds_it() {
        let mut f = Follow::default();
        f.load(&[ev("a", 60, 1000.0, 1, 3), ev("b", 64, 1008.0, 1, 3), ev("c", 67, 2000.0, 1, 3)]);
        f.start(1005.0);
        assert_eq!(f.expected_pitches(), vec![60, 64]);
        f.stop();
        assert_eq!(f.current_onset(), None);
        assert!(f.note_on(60).is_empty());
    }
}
