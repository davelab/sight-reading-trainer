"""homr symbol sequences → MusicXML (omr/symbols.py), without running homr."""

import xml.etree.ElementTree as ET
from collections import Counter
from dataclasses import dataclass
from fractions import Fraction

from score_engine.io.correct import check
from score_engine.io.xml_walk import walk
from score_engine.omr.symbols import parse_duration, symbols_to_musicxml


@dataclass
class S:
    rhythm: str
    pitch: str = "."
    lift: str = "."
    articulation: str = "_"
    slur: str = "_"
    position: str = "."


def note(kern: str, pitch: str, position: str = "upper", lift: str = "_", slur: str = "_") -> S:
    return S(f"note_{kern}", pitch, lift, "_", slur, position)


def rest(kern: str, position: str = "upper") -> S:
    return S(f"rest_{kern}", "_", "_", "_", "_", position)


CHORD = S("chord")
BAR = S("barline")
HEAD = [
    S("clef_G2", position="upper"),
    CHORD,
    S("clef_F4", position="lower"),
    S("keySignature_0"),
    S("timeSignature/4"),
]


def notes(xml: str):
    ns, _ = walk(ET.fromstring(xml.encode()))
    return Counter((n.ref.measure, n.ref.staff, n.ref.offset, n.ref.midi) for n in ns if n.ref.midi)


def test_durations():
    assert parse_duration("16").value == Fraction(1, 16)
    assert parse_duration("8.").value == Fraction(3, 16)
    triplet = parse_duration("24")
    assert (triplet.value, triplet.base, triplet.actual, triplet.normal) == (
        Fraction(1, 24),
        Fraction(1, 16),
        3,
        2,
    )
    assert parse_duration("8G").grace and parse_duration("8G").value == 0


def bwv846_half_measure(e_label: str) -> list[S]:
    """Half a measure of BWV 846 as homr encodes it. e_label is the voice label the model
    gave the dotted E4; homr's own writer moved the rest of the measure when it was wrong."""
    return [
        rest("8", "upper"), CHORD, note("2", "C4", "lower2"), CHORD, rest("16", "lower"),
        note("8.", "E4", e_label, slur="slurStart"),
        note("16", "G4"), note("16", "C5"), note("16", "E5"), CHORD,
        note("4", "E4", "lower", slur="slurStop"),
        note("16", "G4"), note("16", "C5"), note("16", "E5"),
    ]  # fmt: skip


def test_timing_does_not_depend_on_voice_labels():
    right = symbols_to_musicxml([HEAD + bwv846_half_measure("lower") * 2 + [BAR]])
    mislabelled = symbols_to_musicxml([HEAD + bwv846_half_measure("lower2") * 2 + [BAR]])
    assert notes(right) == notes(mislabelled)
    assert check(mislabelled) == []
    on = sorted(o for (_, staff, o, midi) in notes(right) if staff == 1)
    # Right hand: 16ths from the second eighth: 1/2, 3/4, 1, 5/4, 3/2, 7/4 quarters...
    assert on[:6] == [
        Fraction(1, 2),
        Fraction(3, 4),
        Fraction(1),
        Fraction(5, 4),
        Fraction(3, 2),
        Fraction(7, 4),
    ]


def test_time_signature_top_number_from_measure_lengths():
    xml = symbols_to_musicxml([HEAD + bwv846_half_measure("lower") * 2 + [BAR]])
    assert "<beats>4</beats><beat-type>4</beat-type>" in xml


def test_tie_from_slur_between_equal_notes():
    xml = symbols_to_musicxml([HEAD + bwv846_half_measure("lower") * 2 + [BAR]])
    assert xml.count('<tie type="start"') == 2 and xml.count('<tie type="stop"') == 2


def test_misread_triplets_are_repaired_when_the_measure_then_adds_up():
    # 4/4 established by two good measures; the third has its sixteenths read as triplets.
    good = [note("4", "C5")] * 4 + [BAR]
    misread = (
        [note("4", "C5")] * 3
        + [note("24", "D5"), note("24", "E5"), note("24", "F5"), note("16", "G5")]
        + [BAR]
    )
    xml = symbols_to_musicxml([HEAD + good + good + misread])
    assert check(xml) == []
    assert "time-modification" not in xml.split('<measure number="3">')[1]


def test_real_triplets_are_kept_and_numbered_once():
    triplets = [note("24", p) for p in ("C5", "D5", "E5", "F5", "G5", "A5")] * 4 + [BAR]
    xml = symbols_to_musicxml([HEAD + triplets + triplets])
    assert check(xml) == []
    m1, m2 = xml.split('<measure number="2">')
    assert m1.count("<tuplet") == 16 and 'show-number="none"' not in m1
    assert m2.count('show-number="none"') == 16


def test_grace_note_shares_the_next_onset():
    seq = [
        note("8G", "D5"),
        note("4", "C5"),
        note("4", "C5"),
        note("4", "C5"),
        note("4", "C5"),
        BAR,
    ]
    xml = symbols_to_musicxml([HEAD + seq])
    assert check(xml) == []
    assert "<grace" in xml
