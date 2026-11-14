from pathlib import Path

from score_engine.analysis import analyze
from score_engine.analysis.key import best_key, spelled_key
from tests.reference import compare

FIX = Path(__file__).parent / "fixtures"


def test_ks_on_a_c_major_scale():
    w = [2, 0, 1, 0, 1, 1, 0, 1.5, 0, 1, 0, 0.5]
    guess = best_key(w)
    assert (guess.tonic_pc, guess.mode) == (0, "major")
    assert best_key([0.0] * 12) is None


def test_spelling_prefers_fewer_accidentals():
    assert spelled_key(6, "major", 1).tonic.name == "F#"
    assert spelled_key(10, "major").tonic.name == "B-"
    assert spelled_key(3, "minor").tonic.name in ("E-", "D#")


def test_minuet_starts_in_g_major_and_covers_every_measure():
    keys = analyze((FIX / "minuet-in-g.musicxml").read_text()).key
    assert (keys[0].tonic, keys[0].mode, keys[0].from_measure) == ("G", "major", 1)
    assert keys[-1].to_measure == 32
    for a, b in zip(keys, keys[1:], strict=False):
        assert b.from_measure == a.to_measure + 1


def test_modulating_chorale_bwv17_7(chorale):
    """BWV 17.7 moves through A, f#, E and b: the regions must follow it.

    Measured at commit time: 74.8 % of the beats in the analyst's local key.
    """
    keys = analyze(chorale("bwv17.7").read_text()).key
    names = {(k.tonic, k.mode) for k in keys}
    assert keys[0].tonic == "A" and keys[0].mode == "major"
    assert ("E", "major") in names and ("F#", "minor") in names
    assert compare(chorale("bwv17.7"), FIX / "bach-bwv17.7.rntxt").key >= 0.7
