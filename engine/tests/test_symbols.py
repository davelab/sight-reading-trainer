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


def test_cross_staff_triplet_groups_are_repaired():
    """Arpeggio triplets beamed from the bass staff to the treble: the model reads the
    treble note of each group as a plain sixteenth (BWV 851a, measures 6-8)."""
    good = [note("4", "C5")] * 4 + [BAR]
    group = [note("24", "G3", "lower"), note("24", "B3", "lower"), note("16", "D5", "upper")]
    xml = symbols_to_musicxml([HEAD + good + good + group * 8 + [BAR]])
    assert check(xml) == []
    m3 = xml.split('<measure number="3">')[1]
    assert m3.count("<time-modification>") == 24


def _measures(*lengths, signatures=()):
    from fractions import Fraction

    from score_engine.omr.symbols import Duration, Event, Measure

    out = []
    for i, length in enumerate(lengths):
        m = Measure()
        if length:
            value = Fraction(length)
            m.events.append(Event(Fraction(0), Duration(value, value, 0), 1, "C4", 0, "", ""))
        if i in signatures:
            m.time_denominator = signatures[i]
        out.append(m)
    return out


def test_meter_changes_found_from_measure_lengths():
    """I Giorni: 16 measures of 4/4, then 3/4 with no time signature read, a bar of
    rest misread as 1/2, then cut time (homr reads the bottom number, 2)."""
    from score_engine.omr.symbols import meter_regions

    lengths = ["1"] * 16 + ["3/4"] * 20 + ["1/2"] + ["1"] * 6
    regions = meter_regions(_measures(*lengths, signatures={0: 4, 37: 2}))
    assert [(r.start, r.beats, r.beat_type) for r in regions] == [(0, 4, 4), (16, 3, 4), (37, 2, 2)]


def test_a_lone_measure_or_pickup_does_not_change_the_meter():
    from score_engine.omr.symbols import meter_regions

    regions = meter_regions(_measures("1/4", "3/4", "3/4", "1/2", "3/4", "3/4", "3/4"))
    assert [(r.start, r.beats, r.beat_type) for r in regions] == [(0, 3, 4)]
    # Two measures of another length are not enough either; three are.
    assert len(meter_regions(_measures("1", "1", "1", "3/4", "3/4", "1", "1"))) == 1
    assert len(meter_regions(_measures("1", "1", "1", "3/4", "3/4", "3/4"))) == 2


def test_eighth_note_meters():
    from score_engine.omr.symbols import meter_regions

    regions = meter_regions(_measures("3/4", "3/4", "3/4", "3/8", "3/8", "3/8", signatures={0: 4}))
    assert [(r.beats, r.beat_type) for r in regions] == [(3, 4), (3, 8)]


def test_page_start_keeps_the_meter_in_force():
    """A page read on its own starts with 4/4 where the piece is in 2/2."""
    from score_engine.omr.merge import merge_pages

    def page(beats, beat_type):
        return (
            '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>P</part-name>'
            '</score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1'
            f"</divisions><time><beats>{beats}</beats><beat-type>{beat_type}</beat-type></time>"
            "</attributes><note><rest/><duration>4</duration><type>whole</type></note></measure>"
            "</part></score-partwise>"
        )

    merged = merge_pages([page(2, 2), page(4, 4), page(3, 4)])
    assert merged.count("<time>") == 2  # 2/2, then the real change to 3/4
    assert "<beats>4</beats>" not in merged
