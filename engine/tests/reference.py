"""Compare our chord labels with a human RomanText analysis, beat by beat."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from music21 import converter, roman, stream

from score_engine.analysis.common import measure_slices, parse_musicxml
from score_engine.analysis.harmony import ChordLabel, label_chords
from score_engine.analysis.key import key_at, key_regions

TRIAD = {
    "major": "major",
    "dominant-seventh": "major",
    "major-seventh": "major",
    "minor": "minor",
    "minor-seventh": "minor",
    "diminished": "diminished",
    "half-diminished-seventh": "diminished",
    "diminished-seventh": "diminished",
    "augmented": "augmented",
}


@dataclass
class Agreement:
    beats: int
    root_quality: float  # same root and triad quality
    with_bass: float  # ... and same bass (inversion)
    key: float  # same local key (tonic and mode) as the analyst
    mismatches: list[tuple[float, str, str]]


def _reference_timeline(rntxt: Path, score: stream.Score) -> list[tuple[float, roman.RomanNumeral]]:
    part = score.parts[0]
    starts: dict[int, float] = {}
    for m in part.getElementsByClass(stream.Measure):
        if not m.numberSuffix and m.number not in starts:
            pad = float(m.paddingLeft or 0.0)
            if m.number == 0 and pad == 0.0:
                bar = float(m.barDuration.quarterLength)
                pad = bar - float(m.duration.quarterLength)
            starts[m.number] = float(m.offset) - pad
    analysis = converter.parse(rntxt, format="romanText")
    out = []
    for rn in analysis.recurse().getElementsByClass(roman.RomanNumeral):
        beat_ql = float(rn.beatDuration.quarterLength)
        out.append((starts[rn.measureNumber] + (float(rn.beat) - 1) * beat_ql, rn))
    return sorted(out, key=lambda x: x[0])


def compare(musicxml: Path, rntxt: Path) -> Agreement:
    score = parse_musicxml(musicxml.read_text())
    measures = measure_slices(score)
    regions = key_regions(measures, score)
    labels = label_chords(measures, regions)
    start_of = {m.ordinal: m.offset for m in measures}
    ordinal_at = sorted((m.offset, m.ordinal) for m in measures)
    ours: list[tuple[float, ChordLabel]] = sorted(
        ((start_of[c.measure] + c.offset, c) for c in labels), key=lambda x: x[0]
    )
    ref = _reference_timeline(rntxt, score)
    end = max(m.offset + m.duration for m in measures)
    rq = rb = rk = n = 0
    mismatches = []
    t = 0.0
    while t < end - 1e-9:
        r = next((rn for off, rn in reversed(ref) if off <= t + 1e-6), None)
        o = next((c for off, c in reversed(ours) if off <= t + 1e-6), None)
        if r is not None and o is not None:
            n += 1
            same = (
                r.root().pitchClass == o.root_pc
                and TRIAD.get(r.quality, r.quality) == TRIAD[o.quality]
            )
            rq += same
            rb += same and r.bass().pitchClass == o.bass_pc
            ordinal = next(o_ for off, o_ in reversed(ordinal_at) if off <= t + 1e-6)
            k = key_at(regions, ordinal)
            rk += bool(k and k.tonic.pitchClass == r.key.tonic.pitchClass and k.mode == r.key.mode)
            if not same:
                mismatches.append(
                    (t, r.figure + " " + r.key.tonicPitchNameWithCase, o.symbol + " " + o.roman)
                )
        t += 1.0
    return Agreement(n, rq / n, rb / n, rk / n, mismatches)
