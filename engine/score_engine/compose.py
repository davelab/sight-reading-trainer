"""The "Componi" section: a live recording becomes a score, and Claude helps to
develop it.

- transcribe_recording(): notes and pedal recorded from the MIDI piano (seconds
  from the first downbeat). With the metronome on, the beats are known exactly
  and the notation uses them as its grid; without it, the beat is tracked as in
  an audio transcription.
- continue_piece(): Claude reads the last measures and answers with advice (in
  Italian) and, if asked, the next measures written note by note. Each measure
  is appended only if every voice fills it exactly (omr/refine.py checks).
"""

from __future__ import annotations

import base64
import math
import xml.etree.ElementTree as ET
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from .ai import AIError, call_claude
from .io.correct import _serialize
from .io.xml_walk import walk
from .models import TranscribeHints
from .omr.beams import add_beams
from .omr.refine import _fifths_by_measure, describe, parse_measure, rebuild_measure
from .transcribe.midi import to_midi
from .transcribe.notation import to_score
from .transcribe.postprocess import NoteEvent, PedalEvent

MAX_CONTEXT_MEASURES = 16
MAX_NEW_MEASURES = 8


def transcribe_recording(
    notes: list[dict[str, Any]],
    pedals: list[dict[str, Any]],
    bpm: float | None,
    beats_per_measure: int,
    title: str = "Improvvisazione",
    hints: TranscribeHints | None = None,
) -> tuple[str, dict, str]:
    """MusicXML, facts (tempo, meter, key) and the performance as MIDI (base64)."""
    events = [
        NoteEvent(float(n["onset"]), float(n["offset"]), int(n["pitch"]), int(n["velocity"]))
        for n in notes
        if float(n["offset"]) > float(n["onset"]) and 0 <= int(n["pitch"]) <= 127
    ]
    if not events:
        raise ValueError("la registrazione non contiene note")
    pedal_events = [PedalEvent(float(p["onset"]), float(p["offset"])) for p in pedals]
    given = (hints or TranscribeHints()).model_dump(exclude_none=True)
    if 2 <= beats_per_measure <= 4 and "beats_per_measure" not in given:
        given["beats_per_measure"] = beats_per_measure
    grid = None
    if bpm:
        # Played with the metronome: beat k is at k * 60/bpm from the first downbeat.
        beat = 60.0 / bpm
        count = math.ceil(max(e.offset for e in events) / beat) + 2 * max(beats_per_measure, 4)
        # One measure before 0 for notes played in the count-in: a pickup.
        lead = max(1, beats_per_measure)
        grid = np.arange(-lead, count) * beat
        first = min(e.onset for e in events)
        if "pickup_beats" not in given:
            pickup = round(-first / beat) if first < -0.25 * beat else 0
            given["pickup_beats"] = max(0, min(3, lead - 1, pickup))
        given.pop("tempo", None)
    merged = TranscribeHints(**given)
    musicxml, facts = to_score(events, pedal_events, title=title, hints=merged, grid=grid)
    # Times may start before 0 (a pickup during the count-in): MIDI starts at 0.
    shift = -min(0.0, min(e.onset for e in events))
    played = [NoteEvent(e.onset + shift, e.offset + shift, e.pitch, e.velocity) for e in events]
    pedaled = [PedalEvent(p.onset + shift, p.offset + shift) for p in pedal_events]
    midi = base64.b64encode(to_midi(played, pedaled)).decode("ascii")
    return musicxml, facts, midi


# --- Continuing with Claude ---------------------------------------------------------

SYSTEM = """You are a composition teacher and a pianist. A student has just \
improvised an idea at the piano; you get it as notes, measure by measure, with \
its key and meter. Help them develop it.

advice: 3 to 6 short, concrete suggestions in Italian, addressed to the student \
("tu"), each tied to what they played (cite measures, chords, the motif): where \
the harmony could go next, how to vary or sequence the motif, a contrasting \
section, a cadence, texture and register for the left hand. Plain sentences, no \
headings.

measures: when asked for N measures, write the next N measures for piano (two \
staves) that continue the idea in its own style, texture, key and meter, \
following the student's wishes if they gave any. Develop rather than repeat; end \
a phrase where it makes sense.
Conventions:
- onset and duration are fractions of a quarter note, as strings ("0", "1/2", \
"3/2", "1/3" for an eighth-note triplet note).
- staff 1 is the right hand (treble), staff 2 the left hand (bass).
- voice: 1 or 2 for the right hand, 3 or 4 for the left hand.
- pitches: ["C#4"], ["Bb3", "D4", "F4"] for a chord; [] for a rest. Octave 4 \
starts at middle C.
- every voice runs from the bar line to the next without gaps or overlaps: \
write its rests. Each measure has exactly the meter's length.
When no measures are asked for, return an empty list."""

NOTE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "staff": {"type": "integer"},
        "voice": {"type": "integer"},
        "onset": {"type": "string"},
        "duration": {"type": "string"},
        "pitches": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["staff", "voice", "onset", "duration", "pitches"],
    "additionalProperties": False,
}

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "advice": {"type": "array", "items": {"type": "string"}},
        "measures": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"notes": {"type": "array", "items": NOTE_SCHEMA}},
                "required": ["notes"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["advice", "measures"],
    "additionalProperties": False,
}


@dataclass
class Continuation:
    musicxml: str
    advice: list[str]
    added: int
    first_new: int
    problems: list[str] = field(default_factory=list)


Ask = Callable[[str, str, int, str], dict]


def context(musicxml: str) -> tuple[str, str, str]:
    """The last measures as text, the key and the meter, for the request."""
    root = ET.fromstring(musicxml.encode("utf-8"))
    _, infos = walk(root)
    infos = [i for i in infos if i.part_index == 0]
    if not infos:
        raise ValueError("lo spartito non ha battute")
    last = infos[-1]
    shown = [i.ordinal for i in infos[-MAX_CONTEXT_MEASURES:]]
    from music21 import converter

    try:
        k = converter.parseData(musicxml, format="musicxml").analyze("key")
        key = f"{k.tonic.name.replace('-', 'b')} {k.mode}"
    except Exception:  # analysis is a hint, never a failure
        key = "unknown"
    meter = f"{last.time[0]}/{last.time[1]}"
    return describe(musicxml, shown), key, meter


def ask_continuation(api_key: str, reading: str, count: int, request: str) -> dict:
    wish = request.strip() or "(nessuna indicazione: scegli tu)"
    text = f"{reading}\n\nWishes of the student: {wish}\n" + (
        f"Write the next {count} measures." if count else "Advice only: no measures."
    )
    return call_claude(api_key, SYSTEM, [{"type": "text", "text": text}], SCHEMA, "compose")


def continue_piece(
    musicxml: str, count: int, request: str, api_key: str, ask: Ask = ask_continuation
) -> Continuation:
    """Advice and, when `count` > 0, up to `count` new measures appended to the score."""
    count = max(0, min(MAX_NEW_MEASURES, count))
    reading, key, meter = context(musicxml)
    answer = ask(api_key, f"Key: {key}. Meter: {meter}.\n{reading}", count, request)
    advice = [str(a) for a in answer.get("advice", []) if str(a).strip()]
    root = ET.fromstring(musicxml.encode("utf-8"))
    part = root.find("part")
    if part is None:
        raise ValueError("lo spartito non ha parti")
    _, infos = walk(root)
    last = [i for i in infos if i.part_index == 0][-1]
    fifths = _fifths_by_measure(part)[last.ordinal]
    measures = part.findall("measure")
    final_bar = measures[-1].find("barline[@location='right']")
    added, problems = 0, []
    for spec in answer.get("measures", [])[:count]:
        number = last.ordinal + added + 1
        el = ET.SubElement(part, "measure", number=str(number))
        try:
            notes = parse_measure(spec, last.expected, last.staves)
            rebuild_measure(part, el, notes, fifths)
        except (ValueError, KeyError) as e:
            part.remove(el)
            problems.append(f"battuta {number} scartata: {e}")
            break
        added += 1
    if added and final_bar is not None:
        # The final bar line moves to the new end.
        measures[-1].remove(final_bar)
        part.findall("measure")[-1].append(final_bar)
    xml = _serialize(root)
    if added:
        xml = add_beams(xml)
    if not advice and not added:
        raise AIError("Claude non ha proposto nulla: riprova")
    return Continuation(xml, advice, added, last.ordinal + 1, problems)
