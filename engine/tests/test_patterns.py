from pathlib import Path

from music21 import note, pitch, stream

from score_engine.analysis import analyze
from score_engine.analysis.patterns import (
    MeasurePrint,
    find_runs,
    fingerprint,
    interval_name,
)

FIX = Path(__file__).parent / "fixtures"


def onsets(*notes: tuple[float, float, str]):
    return [(off, dur, [pitch.Pitch(p)]) for off, dur, p in notes]


def test_transposed_key_ignores_the_starting_note_but_not_rhythm():
    a = fingerprint(onsets((0, 1, "C5"), (1, 0.5, "D5"), (1.5, 0.5, "E5")))
    b = fingerprint(onsets((0, 1, "G4"), (1, 0.5, "A4"), (1.5, 0.5, "B4")))
    c = fingerprint(onsets((0, 1, "G4"), (1, 1, "A4")))
    assert a.transposed == b.transposed and a.exact != b.exact
    assert a.transposed != c.transposed


def test_diatonic_steps_match_tonal_sequences():
    # C-E-G (major third) and D-F-A (minor third): same shape on the staff.
    a = fingerprint(onsets((0, 1, "C4"), (1, 1, "E4"), (2, 1, "G4")))
    b = fingerprint(onsets((0, 1, "D4"), (1, 1, "F4"), (2, 1, "A4")))
    assert a.transposed == b.transposed


def test_empty_measures_never_match():
    empty = fingerprint([])
    assert empty.exact is None and empty.notes == 0
    assert find_runs([empty, empty, empty], "exact") == []


def test_runs_do_not_overlap_themselves():
    m = fingerprint(onsets((0, 1, "C4"), (1, 1, "D4")))
    # The same measure four times: measures 1-2 repeat at 3-4, never 1-3 at 2-4.
    runs = find_runs([m, m, m, m], "exact")
    assert (0, 2, 2) in runs
    assert all(i + k <= j for i, j, k in runs)


def test_interval_names():
    assert interval_name(pitch.Pitch("A4"), pitch.Pitch("D4")) == "-P5"
    assert interval_name(pitch.Pitch("C5"), pitch.Pitch("B4")) == "-m2"
    assert interval_name(pitch.Pitch("C4"), pitch.Pitch("D4")) == "+M2"
    assert interval_name(pitch.Pitch("C4"), pitch.Pitch("C4")) == "P1"


def test_short_or_thin_repetitions_are_not_phrases():
    # Two-measure motif of two notes repeated: below MIN_NOTES, not reported.
    part = stream.Part()
    for p in ["B3", "C4", "B3", "C4"]:
        m = stream.Measure()
        m.append(note.Note(p, quarterLength=4))
        part.append(m)
    score = stream.Score([part])
    from score_engine.analysis.patterns import find_patterns

    assert find_patterns(score) == []


def test_m4_exit_criterion_minuet_all_repeated_phrases_no_false_positive():
    """M4 exit: every repeated phrase of the Minuet fixture, and nothing else.

    Ground truth, checked note by note on minuet-in-g.musicxml:
    - right hand, measures 1-6 = 9-14 exactly (7 and 15 differ);
    - right hand, 5-6 (C-D-C-B-A | B-C-B-A-G) return at 14-15 one step lower
      (B-C-B-A-G | A-B-A-G-F#);
    - right hand, 21-22 (rising eighths A4-F#5, then G5-F#5-E5) return at 29-30
      a fifth lower (D4-B4, then C5-B4-A4).
    The left hand only repeats pairs of long notes (e.g. B3-C4 at 2 and 25),
    and with both hands together nothing repeats, since the left hand changes
    under the repeated melody.
    """
    patterns = analyze((FIX / "minuet-in-g.musicxml").read_text()).patterns
    got = [(p.hands, p.kind, p.length, p.occurrences, p.interval) for p in patterns]
    assert got == [
        ("right", "exact", 6, [1, 9], None),
        ("right", "transposed", 2, [5, 14], "-m2"),
        ("right", "transposed", 2, [21, 29], "-P5"),
    ]
    assert [p.id for p in patterns] == ["p1", "p2", "p3"]
    assert patterns[2].transpositions == ["P1", "-P5"]


def test_chorale_written_repeat_is_not_a_pattern(chorale):
    """BWV 269 repeats its first section with :||, written once: nothing to report."""
    assert analyze(chorale("bwv269").read_text()).patterns == []


def test_measure_print_is_hashable_for_grouping():
    m = fingerprint(onsets((0, 1, "C4")))
    assert isinstance(m, MeasurePrint) and hash(m.exact) is not None
