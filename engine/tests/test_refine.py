"""Second reading by Claude of suspicious measures. Claude itself is replaced by a
fake that answers what a correct reading would be (or a wrong one)."""

import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

import pytest

from score_engine.io.correct import check
from score_engine.io.xml_walk import walk
from score_engine.omr.refine import describe, parse_measure, refine, suspicious_measures
from tests.conftest import overfill_measure_4

FIX = Path(__file__).parent / "fixtures"
MINUET = (FIX / "minuet-in-g.musicxml").read_text()
PDF = FIX / "minuet-in-g.pdf"

MEASURE_4 = {  # G5 G4 G4 over a dotted half B3
    "measure": 4,
    "confident": True,
    "notes": [
        {"staff": 1, "voice": 1, "onset": "0", "duration": "1", "pitches": ["G5"]},
        {"staff": 1, "voice": 1, "onset": "1", "duration": "1", "pitches": ["G4"]},
        {"staff": 1, "voice": 1, "onset": "2", "duration": "1", "pitches": ["G4"]},
        {"staff": 2, "voice": 3, "onset": "0", "duration": "3", "pitches": ["B3"]},
    ],
}


def notes_of(xml: str, measure: int) -> Counter:
    ns, _ = walk(ET.fromstring(xml.encode()))
    return Counter(
        (n.ref.staff, n.ref.offset, n.ref.midi, n.duration) for n in ns if n.ref.measure == measure
    )


def fake(answer: dict, seen: list | None = None):
    def ask(api_key, images, measures, reading):
        if seen is not None:
            seen.append((api_key, images, measures, reading))
        return answer

    return ask


def test_suspicious_measures():
    assert suspicious_measures(MINUET) == []
    assert suspicious_measures(overfill_measure_4(MINUET)) == [4]


def test_claude_reading_replaces_a_broken_measure():
    broken = overfill_measure_4(MINUET)
    seen: list = []
    out = refine(broken, PDF, [1], [4], "sk-test", ask=fake({"measures": [MEASURE_4]}, seen))
    assert out.changed == [4] and out.kept == []
    assert check(out.musicxml) == []
    assert notes_of(out.musicxml, 4) == notes_of(MINUET, 4)
    assert notes_of(out.musicxml, 5) == notes_of(MINUET, 5)  # the rest is untouched
    key, images, measures, reading = seen[0]
    assert key == "sk-test" and measures == [4] and len(images) == 1
    assert "Measure 4" in reading and "G5" in reading


def test_wrong_or_unsure_readings_are_not_applied():
    broken = overfill_measure_4(MINUET)
    short = {
        **MEASURE_4,
        "notes": MEASURE_4["notes"][:2] + MEASURE_4["notes"][3:],
    }  # one G4 missing
    out = refine(broken, PDF, [1], [4], "k", ask=fake({"measures": [short]}))
    assert out.changed == [] and "non riempie" in out.kept[0][1]
    assert out.musicxml.count("<note") == broken.count("<note")
    out = refine(
        broken, PDF, [1], [4], "k", ask=fake({"measures": [{**MEASURE_4, "confident": False}]})
    )
    assert out.changed == [] and "sicuro" in out.kept[0][1]
    out = refine(broken, PDF, [1], [4], "k", ask=fake({"measures": []}))
    assert out.kept == [(4, "Claude non l'ha riletta")]


def test_cross_staff_triplets_rebuilt():
    """Like BWV 851a m. 6 (in 3/4 here): triplet groups whose first two notes are on
    the lower staff and the third on the upper, one voice; a bass line below."""
    notes = []
    for k in range(6):
        onset = k * 3  # in sixths of a quarter
        notes += [
            {"staff": 2, "voice": 1, "onset": f"{onset}/6", "duration": "1/6", "pitches": ["C4"]},
            {
                "staff": 2,
                "voice": 1,
                "onset": f"{onset + 1}/6",
                "duration": "1/6",
                "pitches": ["A3"],
            },
            {
                "staff": 1,
                "voice": 1,
                "onset": f"{onset + 2}/6",
                "duration": "1/6",
                "pitches": ["F#4"],
            },
        ]
    notes += [
        {"staff": 2, "voice": 3, "onset": "0", "duration": "1", "pitches": ["D2"]},
        {"staff": 2, "voice": 3, "onset": "1", "duration": "1/2", "pitches": []},
        {"staff": 2, "voice": 3, "onset": "3/2", "duration": "3/2", "pitches": ["Eb3", "G3"]},
    ]
    spec = {"measure": 4, "confident": True, "notes": notes}
    out = refine(overfill_measure_4(MINUET), PDF, [1], [4], "k", ask=fake({"measures": [spec]}))
    assert out.changed == [4] and check(out.musicxml) == []
    root = ET.fromstring(out.musicxml.encode())
    m4 = root.find("part").findall("measure")[3]
    voice1 = [n for n in m4.findall("note") if n.findtext("voice") == "1"]
    assert {n.findtext("staff") for n in voice1} == {"1", "2"}
    assert all(n.find("time-modification") is not None for n in voice1)
    assert len(m4.findall(".//tuplet[@type='start']")) == 6
    assert m4.findall(".//tuplet[@show-number='actual']") and m4.find(".//beam") is not None
    # F# needs no sign in G major; Eb does; a dotted quarter chord.
    accidentals = [
        n.findtext("accidental") for n in m4.findall("note") if n.find("accidental") is not None
    ]
    assert accidentals == ["flat"]
    assert len(m4.findall("note/dot")) == 2


def test_measure_validation():
    with pytest.raises(ValueError, match="fuori"):
        parse_measure(
            {"notes": [{"staff": 1, "voice": 1, "onset": "5/2", "duration": "1", "pitches": []}]},
            3,
            2,
        )
    with pytest.raises(ValueError, match="non riempie"):  # a gap: rests must be written
        parse_measure(
            {
                "notes": [
                    {"staff": 1, "voice": 1, "onset": "1", "duration": "2", "pitches": ["C4"]},
                    {"staff": 2, "voice": 3, "onset": "0", "duration": "3", "pitches": ["C3"]},
                ]
            },
            3,
            2,
        )
    with pytest.raises(ValueError, match="sovrapposte"):
        parse_measure(
            {
                "notes": [
                    {"staff": 1, "voice": 1, "onset": "0", "duration": "2", "pitches": ["C4"]},
                    {"staff": 1, "voice": 1, "onset": "1", "duration": "1", "pitches": ["D4"]},
                    {"staff": 2, "voice": 3, "onset": "0", "duration": "3", "pitches": ["C3"]},
                ]
            },
            3,
            2,
        )
    with pytest.raises(ValueError, match="altezza"):
        parse_measure(
            {"notes": [{"staff": 1, "voice": 1, "onset": "0", "duration": "1", "pitches": ["H4"]}]},
            3,
            1,
        )
    with pytest.raises(ValueError, match="scrivibile"):
        parse_measure(
            {"notes": [{"staff": 1, "voice": 1, "onset": "0", "duration": "5/7", "pitches": []}]},
            3,
            1,
        )


def test_reading_sent_to_claude():
    text = describe(MINUET, [1])
    assert text.splitlines()[0] == "Measure 1 (printed number 1), 3/4:"
    assert "staff 1 voice 1: 0:D5(1) 1:G4(1/2)" in text


def test_rpc_refine_needs_a_pdf_and_valid_params(tmp_path):
    from score_engine.methods import omr_refine
    from score_engine.rpc import RpcError

    with pytest.raises(RpcError, match="not found"):
        omr_refine({"pdfPath": str(tmp_path / "x.pdf"), "musicxml": MINUET, "apiKey": "k"})
    with pytest.raises(RpcError, match="apiKey"):
        omr_refine({"pdfPath": str(PDF), "musicxml": MINUET})
    with pytest.raises(RpcError, match="extraMeasures"):
        omr_refine({"pdfPath": str(PDF), "musicxml": MINUET, "apiKey": "k", "extraMeasures": ["a"]})
    # Nothing suspicious and nothing picked: no request at all.
    result = omr_refine({"pdfPath": str(PDF), "musicxml": MINUET, "apiKey": "k"})
    assert result.changed == [] and result.kept == [] and result.musicxml == MINUET
