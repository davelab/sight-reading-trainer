//! Live recording from the MIDI piano (or the on-screen keyboard), for the
//! "Componi" section: notes and sustain pedal with their times, taken in the
//! MIDI thread when each message arrives (never in the web view).
//!
//! Pure state machine: times are given by the caller in milliseconds from any
//! origin; `start(at)` sets the origin (the first downbeat after the count-in),
//! so notes played during the count-in (a pickup) get negative times.

use std::collections::HashMap;

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedNote {
    /// Seconds from the first downbeat.
    pub onset: f64,
    pub offset: f64,
    pub pitch: u8,
    pub velocity: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedPedal {
    pub onset: f64,
    pub offset: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    pub notes: Vec<RecordedNote>,
    pub pedals: Vec<RecordedPedal>,
    /// Seconds from the first downbeat to the stop.
    pub duration: f64,
    /// The metronome's tempo when one was used (then beats are exact).
    pub bpm: Option<f64>,
    pub beats_per_measure: u32,
}

#[derive(Debug, Default)]
pub struct Recorder {
    origin_ms: Option<f64>,
    held: HashMap<u8, (f64, u8)>,
    pedal_down: Option<f64>,
    notes: Vec<RecordedNote>,
    pedals: Vec<RecordedPedal>,
    bpm: Option<f64>,
    beats_per_measure: u32,
}

impl Recorder {
    pub fn is_recording(&self) -> bool {
        self.origin_ms.is_some()
    }

    /// Start recording; `origin_ms` is the first downbeat (after the count-in).
    pub fn start(&mut self, origin_ms: f64, bpm: Option<f64>, beats_per_measure: u32) {
        *self = Self { origin_ms: Some(origin_ms), bpm, beats_per_measure, ..Self::default() };
    }

    fn secs(&self, at_ms: f64) -> f64 {
        (at_ms - self.origin_ms.unwrap_or(0.0)) / 1000.0
    }

    pub fn note(&mut self, pitch: u8, velocity: u8, on: bool, at_ms: f64) {
        if !self.is_recording() {
            return;
        }
        let t = self.secs(at_ms);
        if let Some((onset, vel)) = self.held.remove(&pitch) {
            // Note-off, or the same key struck again: the previous one ends here.
            self.notes.push(RecordedNote { onset, offset: t.max(onset + 0.01), pitch, velocity: vel });
        }
        if on {
            self.held.insert(pitch, (t, velocity.max(1)));
        }
    }

    pub fn pedal(&mut self, down: bool, at_ms: f64) {
        if !self.is_recording() {
            return;
        }
        let t = self.secs(at_ms);
        match (down, self.pedal_down) {
            (true, None) => self.pedal_down = Some(t),
            (false, Some(onset)) => {
                self.pedals.push(RecordedPedal { onset, offset: t });
                self.pedal_down = None;
            }
            _ => {}
        }
    }

    /// Stop: keys still held and a pedal still down end now.
    pub fn stop(&mut self, at_ms: f64) -> Option<Recording> {
        self.origin_ms?;
        let t = self.secs(at_ms);
        let mut held: Vec<_> = self.held.drain().collect();
        held.sort_by(|a, b| a.1 .0.total_cmp(&b.1 .0));
        for (pitch, (onset, velocity)) in held {
            self.notes.push(RecordedNote { onset, offset: t.max(onset + 0.01), pitch, velocity });
        }
        if let Some(onset) = self.pedal_down.take() {
            self.pedals.push(RecordedPedal { onset, offset: t });
        }
        let mut notes = std::mem::take(&mut self.notes);
        notes.sort_by(|a, b| a.onset.total_cmp(&b.onset).then(a.pitch.cmp(&b.pitch)));
        let recording = Recording {
            notes,
            pedals: std::mem::take(&mut self.pedals),
            duration: t.max(0.0),
            bpm: self.bpm,
            beats_per_measure: self.beats_per_measure,
        };
        self.origin_ms = None;
        Some(recording)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_notes_and_pedal_from_the_downbeat() {
        let mut r = Recorder::default();
        r.note(60, 90, true, 0.0); // before start: ignored
        r.start(1000.0, Some(120.0), 4);
        r.note(55, 70, true, 800.0); // during the count-in: a pickup
        r.note(55, 0, false, 1100.0);
        r.pedal(true, 1000.0);
        r.note(60, 90, true, 1000.0);
        r.note(64, 80, true, 1500.0);
        r.note(60, 0, false, 1900.0);
        r.pedal(false, 2400.0);
        let rec = r.stop(3000.0).expect("recording");
        let got: Vec<_> = rec.notes.iter().map(|n| (n.pitch, n.onset, n.offset)).collect();
        assert_eq!(got, vec![(55, -0.2, 0.1), (60, 0.0, 0.9), (64, 0.5, 2.0)]);
        assert_eq!(rec.pedals, vec![RecordedPedal { onset: 0.0, offset: 1.4 }]);
        assert_eq!((rec.duration, rec.bpm, rec.beats_per_measure), (2.0, Some(120.0), 4));
        assert!(!r.is_recording() && r.stop(4000.0).is_none());
    }

    #[test]
    fn a_key_struck_again_ends_the_previous_note() {
        let mut r = Recorder::default();
        r.start(0.0, None, 4);
        r.note(60, 90, true, 0.0);
        r.note(60, 90, true, 500.0);
        let rec = r.stop(800.0).expect("recording");
        assert_eq!(rec.notes.len(), 2);
        assert_eq!((rec.notes[0].offset, rec.notes[1].onset), (0.5, 0.5));
    }
}
