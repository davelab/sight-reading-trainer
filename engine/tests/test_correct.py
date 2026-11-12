from fractions import Fraction

import pytest
from music21 import converter

from score_engine.io.correct import EditError, apply_edit, check, key_alter
from score_engine.io.xml_walk import NoteRef
from tests.conftest import overfill_measure_4


@pytest.fixture
def xml(minuet_path):
    return minuet_path.read_text()


def rh(musicxml: str, measure: int) -> list[str]:
    s = converter.parse(musicxml, format="musicxml")
    return [
        n.nameWithOctave if n.isNote else "rest" for n in s.parts[0].measure(measure).notesAndRests
    ]


def test_key_signature_alterations():
    assert key_alter("F", 1) == 1 and key_alter("C", 1) == 0
    assert key_alter("B", -1) == -1 and key_alter("E", -2) == -1 and key_alter("A", -2) == 0


def test_step_moves_follow_the_key(xml):
    # Measure 3 (G major): E5 C5 D5 E5 F#5. E5 up one step is F#5, not F5.
    out = apply_edit(xml, NoteRef(3, 1, Fraction(0), 76), "step-up")
    assert rh(out, 3)[0] == "F#5"
    # ...and C5 down one step is B4; octaves wrap correctly (C4 -> B3).
    out = apply_edit(xml, NoteRef(3, 1, Fraction(1), 72), "step-down")
    assert rh(out, 3)[1] == "B4"


def test_accidentals(xml):
    out = apply_edit(xml, NoteRef(3, 1, Fraction(5, 2), 78), "natural")
    assert rh(out, 3)[-1] == "F5"
    assert "<accidental>natural</accidental>" in out
    out = apply_edit(out, NoteRef(3, 1, Fraction(5, 2), 77), "sharp")
    assert rh(out, 3)[-1] == "F#5"
    assert "<accidental>" not in out.split('<measure number="3">')[1].split("</measure>")[0]
    out = apply_edit(xml, NoteRef(1, 1, Fraction(0), 74), "flat")
    assert rh(out, 1)[0] == "D-5"


def test_delete_turns_a_single_note_into_a_rest(xml):
    out = apply_edit(xml, NoteRef(2, 1, Fraction(1), 67), "delete")
    assert rh(out, 2) == ["D5", "rest", "G4"]
    assert check(out) == []  # same duration: the measure still adds up


def test_delete_drops_one_note_of_a_chord():
    chord = """<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"/></part-list>
    <part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>1</beats>
    <beat-type>4</beat-type></time></attributes>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note>
    <note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration></note>
    </measure></part></score-partwise>"""
    out = apply_edit(chord, NoteRef(1, 1, Fraction(0), 60), "delete")  # the chord's first note
    s = converter.parse(out, format="musicxml")
    assert [p.nameWithOctave for p in s.recurse().getElementsByClass("Chord")[0].pitches] == [
        "E4",
        "G4",
    ]


def test_unknown_note_is_an_error(xml):
    with pytest.raises(EditError, match="nota non trovata"):
        apply_edit(xml, NoteRef(1, 1, Fraction(0), 60), "step-up")
    with pytest.raises(EditError):
        apply_edit("<not xml", NoteRef(1, 1, Fraction(0), 60), "step-up")


def test_check_reports_measures_that_do_not_add_up(xml):
    broken = overfill_measure_4(xml)  # right-hand G5 a quarter too long
    assert broken != xml
    warnings = check(broken)
    assert [(w.measure, w.staff, w.kind) for w in warnings] == [(4, 1, "duration")]
    assert warnings[0].message == "Battuta 4 (m. destra): troppo piena, 4/4 invece di 3/4"


def test_check_ignores_a_short_pickup_and_last_measure(xml):
    # Drop the first right-hand quarter of measure 1: a pickup-like first measure is fine.
    head, tail = xml.split("<note>", 1)
    shortened = head + tail.split("</note>", 1)[1]
    assert all(w.measure != 1 for w in check(shortened))
