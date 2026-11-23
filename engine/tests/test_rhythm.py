"""Rhythm corrections (io/rhythm.py through correct.edit) on the Minuet fixture."""

import xml.etree.ElementTree as ET
from collections import Counter
from fractions import Fraction

import pytest

from score_engine.io.correct import EditError, check, edit
from score_engine.io.xml_walk import NoteRef, walk


@pytest.fixture
def xml(minuet_path):
    return minuet_path.read_text()


def staff_notes(musicxml: str, staff: int, measure: int | None = None):
    notes, _ = walk(ET.fromstring(musicxml.encode()))
    return sorted(
        (n.ref.measure, n.ref.offset, n.ref.midi, n.duration)
        for n in notes
        if n.ref.staff == staff and (measure is None or n.ref.measure == measure)
    )


def warnings_at(musicxml: str):
    return [(w.measure, w.staff) for w in check(musicxml)]


def test_set_duration_and_dot(xml):
    # Measure 2, right hand: D5 G4 G4 (quarters). D5 -> half: one quarter too many.
    out, ref = edit(xml, NoteRef(2, 1, Fraction(0), 74), "set-duration", "half")
    assert ref.offset == 0 and ref.midi == 74
    assert warnings_at(out) == [(2, 1)]
    assert [o for _, o, _, _ in staff_notes(out, 1, 2)] == [0, 2, 3]
    assert staff_notes(out, 2) == staff_notes(xml, 2), "the left hand keeps its place"
    back, _ = edit(out, ref, "set-duration", "quarter")
    assert check(back) == []
    dotted, _ = edit(xml, NoteRef(2, 1, Fraction(0), 74), "toggle-dot")
    assert [d for _, _, _, d in staff_notes(dotted, 1, 2)][0] == Fraction(3, 2)


def test_triplet_from_the_selected_note(xml):
    # Measure 3, right hand: E5 quarter, then C5 D5 E5 F#5 eighths. C5 D5 E5 -> triplet.
    out, ref = edit(xml, NoteRef(3, 1, Fraction(1), 72), "triplet")
    rh = staff_notes(out, 1, 3)
    assert [o for _, o, _, _ in rh] == [0, 1, Fraction(4, 3), Fraction(5, 3), 2]
    assert out.count("<time-modification>") == 3
    assert 'tuplet type="start"' in out and 'tuplet type="stop"' in out
    assert staff_notes(out, 2) == [(m, o, p, d) for m, o, p, d in staff_notes(xml, 2)]
    assert (3, 1) in warnings_at(out)  # now half a beat short, as it should report


def test_triplets_for_a_whole_measure():
    from score_engine.omr.symbols import symbols_to_musicxml
    from tests.test_symbols import BAR, HEAD, note

    good = [note("4", "C5")] * 4 + [BAR]
    sixteenths = [note("16", p) for p in ("G3", "B3", "D5")] * 8 + [BAR]  # 24 plain 16ths
    xml = symbols_to_musicxml([HEAD + good + good + sixteenths])
    assert (3, 1) in warnings_at(xml)
    first = next(n for n in staff_notes(xml, 1, 3))
    out, _ = edit(xml, NoteRef(3, 1, first[1], first[2]), "triplet-measure")
    assert warnings_at(out) == []
    assert out.split('<measure number="3">')[1].count("<time-modification>") == 24


def test_insert_after_and_delete_with_time(xml):
    out, ref = edit(xml, NoteRef(2, 1, Fraction(0), 74), "insert-after")
    assert (ref.offset, ref.midi) == (1, 74)
    assert [o for _, o, _, _ in staff_notes(out, 1, 2)] == [0, 1, 2, 3]
    assert warnings_at(out) == [(2, 1)]
    back, _ = edit(out, ref, "delete-time")
    assert staff_notes(back, 1) == staff_notes(xml, 1)
    assert check(back) == []


def test_toggle_chord_both_ways(xml):
    # Measure 1, right hand: A4 (offset 1.5) joins G4 (offset 1) as a chord...
    joined, ref = edit(xml, NoteRef(1, 1, Fraction(3, 2), 69), "toggle-chord")
    assert ref.offset == 1
    assert [o for _, o, _, _ in staff_notes(joined, 1, 1)] == [0, 1, 1, Fraction(3, 2), 2]
    # ...and is split off again.
    split, ref = edit(joined, ref, "toggle-chord")
    assert staff_notes(split, 1) == staff_notes(xml, 1)
    assert check(split) == []


def test_octave(xml):
    out, ref = edit(xml, NoteRef(1, 1, Fraction(0), 74), "octave-up")
    assert ref.midi == 86
    out, ref = edit(out, ref, "octave-down")
    assert ref.midi == 74


def test_rhythm_errors_are_reported(xml):
    with pytest.raises(EditError, match="tre note"):
        edit(xml, NoteRef(2, 1, Fraction(2), 67), "triplet")  # only one note after it
    with pytest.raises(EditError, match="precedente"):
        edit(xml, NoteRef(1, 1, Fraction(0), 74), "toggle-chord")
    with pytest.raises(EditError, match="durata"):
        edit(xml, NoteRef(1, 1, Fraction(0), 74), "set-duration", "forever")


def test_divisions_grow_for_triplets_without_moving_anything(xml):
    before = Counter((m, o, p) for m, o, p, _ in staff_notes(xml, 2))
    out, _ = edit(xml, NoteRef(1, 1, Fraction(1), 67), "triplet")
    assert "<divisions>6</divisions>" in out
    assert Counter((m, o, p) for m, o, p, _ in staff_notes(out, 2)) == before
