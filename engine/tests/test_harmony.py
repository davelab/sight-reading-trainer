from pathlib import Path

import pytest

from score_engine.analysis import analyze
from score_engine.analysis.harmony import best_template
from tests.reference import compare

FIX = Path(__file__).parent / "fixtures"
MAJOR_C = {0, 2, 4, 5, 7, 9, 11}


def weights(**pcs: float) -> list[float]:
    names = ["C", "Cs", "D", "Ds", "E", "F", "Fs", "G", "Gs", "A", "As", "B"]
    return [pcs.get(n, 0.0) for n in names]


def test_template_ignores_a_short_passing_tone():
    # C-E-G for the whole beat in four voices, D as an eighth-note passing tone.
    _, root, tmpl = best_template(weights(C=2, E=1, G=0.5, D=0.5), 1.0, 0, MAJOR_C)
    assert (root, tmpl.quality) == (0, "major")


def test_seventh_needs_a_sustained_seventh():
    _, root, tmpl = best_template(weights(G=2, B=1, D=1, F=0.5), 1.0, 7, MAJOR_C)
    assert tmpl.quality == "major"
    _, root, tmpl = best_template(weights(G=1, B=1, D=1, F=1), 1.0, 7, MAJOR_C)
    assert (root, tmpl.quality) == (7, "dominant-seventh")


def test_two_notes_never_make_a_seventh_chord():
    # G and A alone: no triad has both, and a seventh chord needs three of its tones.
    assert best_template(weights(G=1.5, A=0.5), 1.0, 7, MAJOR_C) is None
    _, _, tmpl = best_template(weights(G=1.5, B=0.5), 1.0, 7, MAJOR_C)
    assert len(tmpl.semitones) == 3


@pytest.fixture(scope="module")
def bwv269(chorale):
    return analyze(chorale("bwv269").read_text())


def test_chorale_global_key_is_g_major(bwv269):
    assert (bwv269.key[0].tonic, bwv269.key[0].mode, bwv269.key[0].from_measure) == (
        "G",
        "major",
        1,
    )


def test_chorale_first_chord_and_cadence(bwv269):
    first = bwv269.chords[0]
    assert (first.measure, first.beat, first.symbol, first.roman, first.function) == (
        1,
        3.0,
        "G",
        "I",
        "tonic",
    )
    # m. 6 of the print = ordinal 7. Analyst: "m6 I6 b2 ii6/5 b3 V b3.5 V7"; the seventh
    # only arrives on the second half of beat 3, so the beat is labelled V.
    m7 = [(c.beat, c.roman, c.function) for c in bwv269.chords if c.measure == 7]
    assert m7 == [(1.0, "I6", "tonic"), (2.0, "ii65", "predominant"), (3.0, "V", "dominant")]


def test_chorale_secondary_dominant(bwv269):
    # m. 13 b. 3 of the print (ordinal 15): G7 = V7/IV, as in the reference analysis.
    chord = next(c for c in bwv269.chords if c.measure == 15 and c.beat == 3.0)
    assert (chord.symbol, chord.roman, chord.function) == ("G7", "V7/IV", "dominant")


def test_every_chord_is_anchored_to_a_position(bwv269):
    for c in bwv269.chords:
        assert c.measure >= 1 and c.beat > 0 and c.offset >= 0
        assert c.function in ("tonic", "predominant", "dominant", "other")


def test_m3_exit_criterion_bwv269_matches_the_reference_analysis(chorale):
    """M3 exit: the chorale's chords compared with a human analysis (When in Rome).

    Measured at commit time: 90.5 % same root and quality, 88.9 % same bass too,
    82.5 % same local key, over 63 beats. The thresholds leave a small margin.
    """
    a = compare(chorale("bwv269"), FIX / "bach-bwv269.rntxt")
    assert a.beats == 63
    assert a.root_quality >= 0.85, a.mismatches
    assert a.with_bass >= 0.85
    assert a.key >= 0.75


def test_minor_key_vi_and_vii_have_no_flat():
    """In D minor, Bb major is VI and C major is VII (not bVI / bVII)."""
    from music21 import key

    from score_engine.analysis.harmony import _consistent_figure

    d = key.Key("d")
    assert _consistent_figure("bVII", {0, 4, 7}, d) == "VII"
    assert _consistent_figure("bVI6", {10, 2, 5}, d) == "VI6"
    assert _consistent_figure("iv", {7, 10, 2}, d) == "iv"
    assert _consistent_figure("bII6", {3, 7, 10}, d) == "bII6"  # Neapolitan: the flat is right
