"""Componi: a live recording to a score, and Claude's continuation (faked here)."""

import xml.etree.ElementTree as ET

import pytest

from score_engine.ai import AIError
from score_engine.compose import context, continue_piece, transcribe_recording
from score_engine.io.correct import check
from score_engine.io.xml_walk import walk
from tests.test_transcribe import agreement, score_notes


def recorded(bpm=100.0, swing=0.0, pickup=False):
    """The minuet as played with the metronome (seconds from the first downbeat)."""
    beat = 60 / bpm
    notes = []
    for i, (start, length, pitch) in enumerate(score_notes()):
        jitter = swing * ((i % 3) - 1)
        notes.append(
            {
                "onset": start * beat + jitter,
                "offset": (start + length) * beat - 0.03,
                "pitch": pitch,
                "velocity": 70,
            }
        )
    if pickup:
        notes.insert(0, {"onset": -beat, "offset": -0.05, "pitch": 62, "velocity": 60})
    return notes


def test_recording_with_metronome_uses_its_beats():
    xml, facts, midi = transcribe_recording(
        recorded(swing=0.02), [{"onset": 0, "offset": 1.0}], 100.0, 3
    )
    assert facts["tempo"] == 100 and facts["beatsPerMeasure"] == 3 and facts["key"] == "G major"
    assert agreement(xml) == 1.0
    assert check(xml) == []
    assert midi.startswith("TVRoZ")  # "MThd"
    assert '<pedal type="start"' in xml


def test_a_pickup_played_during_the_count_in():
    xml, facts, _ = transcribe_recording(recorded(pickup=True), [], 100.0, 3)
    assert facts["pickupBeats"] == 1.0


def test_recording_without_metronome_is_beat_tracked():
    xml, facts, _ = transcribe_recording(recorded(bpm=110.0), [], None, 3)
    assert facts["beatsPerMeasure"] == 3
    assert agreement(xml) >= 0.95


def test_empty_recording():
    with pytest.raises(ValueError, match="non contiene note"):
        transcribe_recording([], [], 100.0, 4)


def score():
    xml, _, _ = transcribe_recording(recorded(), [], 100.0, 3)
    return xml


TWO_MEASURES = [
    {
        "notes": [
            {"staff": 1, "voice": 1, "onset": "0", "duration": "1", "pitches": ["B4"]},
            {"staff": 1, "voice": 1, "onset": "1", "duration": "1", "pitches": ["A4"]},
            {"staff": 1, "voice": 1, "onset": "2", "duration": "1", "pitches": ["G4"]},
            {"staff": 2, "voice": 3, "onset": "0", "duration": "3", "pitches": ["G2", "D3"]},
        ]
    },
    {
        "notes": [
            {"staff": 1, "voice": 1, "onset": "0", "duration": "3", "pitches": ["G4", "B4", "D5"]},
            {"staff": 2, "voice": 3, "onset": "0", "duration": "3", "pitches": ["G2"]},
        ]
    },
]


def test_claude_continues_the_piece():
    base = score()
    seen = []

    def ask(api_key, reading, count, request):
        seen.append((api_key, reading, count, request))
        return {"advice": ["Prova a portare il motivo in Re maggiore."], "measures": TWO_MEASURES}

    out = continue_piece(base, 2, "più cantabile", "sk-test", ask=ask)
    _, before = walk(ET.fromstring(base.encode()))
    _, after = walk(ET.fromstring(out.musicxml.encode()))
    assert (out.added, out.first_new) == (2, len(before) + 1)
    assert len(after) == len(before) + 2
    assert check(out.musicxml) == []
    assert out.advice == ["Prova a portare il motivo in Re maggiore."]
    key, reading, count, request = seen[0]
    assert (key, count, request) == ("sk-test", 2, "più cantabile")
    assert reading.startswith("Key: G major. Meter: 3/4.")
    # The final bar line moved to the new last measure.
    measures = ET.fromstring(out.musicxml.encode()).find("part").findall("measure")
    assert measures[-1].find("barline") is not None and measures[-3].find("barline") is None


def test_a_measure_that_does_not_fit_stops_the_continuation():
    bad = {"notes": [{"staff": 1, "voice": 1, "onset": "0", "duration": "2", "pitches": ["C5"]}]}

    out = continue_piece(
        score(), 3, "", "k", ask=lambda *a: {"advice": ["ok"], "measures": [TWO_MEASURES[0], bad]}
    )
    assert out.added == 1 and "battuta" in out.problems[0]
    assert check(out.musicxml) == []


def test_advice_only_and_empty_answers():
    out = continue_piece(
        score(), 0, "", "k", ask=lambda *a: {"advice": ["Un'idea"], "measures": TWO_MEASURES}
    )
    assert out.added == 0 and out.advice == ["Un'idea"]
    with pytest.raises(AIError):
        continue_piece(score(), 2, "", "k", ask=lambda *a: {"advice": [], "measures": []})


def test_context_keeps_the_last_measures():
    reading, key, meter = context(score())
    assert (key, meter) == ("G major", "3/4")
    assert reading.splitlines()[0].startswith("Measure 17 ")  # 32 measures, last 16 shown
