//! MIDI input with midir (CoreMIDI on macOS, ALSA on Linux).
//!
//! Web MIDI does not exist in WKWebView: every MIDI byte goes through Rust.
//! Note on/off and the sustain pedal (CC 64) matter; everything else (clock,
//! active sensing, other controllers) is ignored.

use midir::{MidiInput, MidiInputConnection};
use serde::Serialize;

const CLIENT_NAME: &str = "Score Studio";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct NoteMessage {
    pub pitch: u8,
    pub velocity: u8,
    pub on: bool,
}

/// Decode a channel voice message. Note-on with velocity 0 is a note-off.
pub fn parse(message: &[u8]) -> Option<NoteMessage> {
    let (&status, data) = message.split_first()?;
    let (&pitch, &velocity) = (data.first()?, data.get(1)?);
    if pitch > 127 || velocity > 127 {
        return None;
    }
    match status & 0xF0 {
        0x90 => Some(NoteMessage { pitch, velocity, on: velocity > 0 }),
        0x80 => Some(NoteMessage { pitch, velocity, on: false }),
        _ => None,
    }
}

/// Sustain pedal (controller 64) on any channel: Some(down) for a pedal message.
pub fn parse_pedal(message: &[u8]) -> Option<bool> {
    match message {
        [status, 64, value] if status & 0xF0 == 0xB0 && *value <= 127 => Some(*value >= 64),
        _ => None,
    }
}

fn client() -> Result<MidiInput, String> {
    let mut input = MidiInput::new(CLIENT_NAME).map_err(|e| format!("MIDI non disponibile: {e}"))?;
    input.ignore(midir::Ignore::All); // SysEx, timing clock, active sensing
    Ok(input)
}

/// Names of the MIDI input ports currently available.
pub fn list_inputs() -> Result<Vec<String>, String> {
    let input = client()?;
    Ok(input.ports().iter().filter_map(|p| input.port_name(p).ok()).collect())
}

/// An open input; the port stays connected while this value lives.
pub struct Connection {
    pub name: String,
    _conn: MidiInputConnection<()>,
}

/// Connect to the input port called `name`, calling `on_note` for every note message.
pub fn connect(
    name: &str,
    mut on_note: impl FnMut(NoteMessage) + Send + 'static,
    mut on_pedal: impl FnMut(bool) + Send + 'static,
) -> Result<Connection, String> {
    let input = client()?;
    let port = input
        .ports()
        .into_iter()
        .find(|p| input.port_name(p).is_ok_and(|n| n == name))
        .ok_or_else(|| format!("dispositivo MIDI non trovato: {name}"))?;
    let conn = input
        .connect(
            &port,
            "score-studio-in",
            move |_stamp, message, _| {
                if let Some(note) = parse(message) {
                    on_note(note);
                } else if let Some(down) = parse_pedal(message) {
                    on_pedal(down);
                }
            },
            (),
        )
        .map_err(|e| format!("impossibile aprire {name}: {e}"))?;
    Ok(Connection { name: name.to_string(), _conn: conn })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_sustain_pedal() {
        assert_eq!(parse_pedal(&[0xB0, 64, 127]), Some(true));
        assert_eq!(parse_pedal(&[0xB3, 64, 10]), Some(false));
        assert_eq!(parse_pedal(&[0xB0, 7, 100]), None);
        assert_eq!(parse(&[0xB0, 64, 127]), None);
    }

    #[test]
    fn parses_note_on_off_on_any_channel() {
        assert_eq!(parse(&[0x90, 60, 100]), Some(NoteMessage { pitch: 60, velocity: 100, on: true }));
        assert_eq!(parse(&[0x93, 60, 0]), Some(NoteMessage { pitch: 60, velocity: 0, on: false }));
        assert_eq!(parse(&[0x8F, 61, 64]), Some(NoteMessage { pitch: 61, velocity: 64, on: false }));
    }

    #[test]
    fn ignores_everything_else() {
        assert_eq!(parse(&[0xB0, 64, 127]), None); // sustain pedal
        assert_eq!(parse(&[0xF8]), None); // timing clock
        assert_eq!(parse(&[0x90, 60]), None); // truncated
        assert_eq!(parse(&[]), None);
    }
}
