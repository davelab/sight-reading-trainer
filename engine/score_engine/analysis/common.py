"""Shared score reduction for the analyses: vertical slices per measure.

Measures are identified by their 1-based ORDINAL in the written score (a
pickup is measure 1, a measure split by a repeat — "7" and "7a" — counts as
two). The frontend maps the same ordinal to the n-th measure Verovio draws.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from music21 import converter, pitch, stream


@dataclass
class Slice:
    """A vertical sonority: the pitches sounding from `offset` for `duration` quarters."""

    offset: float  # quarter lengths from the start of the measure
    duration: float
    pitches: list[pitch.Pitch]


@dataclass
class MeasureSlices:
    ordinal: int
    number: str  # as printed, e.g. "7a"
    offset: float  # quarter lengths from the start of the score
    duration: float
    beat_duration: float  # quarter lengths per beat in this measure's meter
    padding_left: float  # missing duration at the start of a pickup measure
    slices: list[Slice] = field(default_factory=list)


def parse_musicxml(musicxml: str) -> stream.Score:
    score = converter.parse(musicxml, format="musicxml", forceSource=True)
    if not isinstance(score, stream.Score):
        wrapped = stream.Score()
        wrapped.insert(0, score)
        score = wrapped
    return score


def measure_slices(score: stream.Score) -> list[MeasureSlices]:
    """Reduce all parts to one sequence of vertical slices, measure by measure."""
    chordified = score.chordify()
    measures = list(chordified.getElementsByClass(stream.Measure))
    out: list[MeasureSlices] = []
    meter = None
    for i, m in enumerate(measures, start=1):
        meter = m.timeSignature or meter or m.getContextByClass("TimeSignature")
        beat = float(meter.beatDuration.quarterLength) if meter else 1.0
        bar = float(meter.barDuration.quarterLength) if meter else float(m.duration.quarterLength)
        duration = float(m.duration.quarterLength)
        padding = float(m.paddingLeft or 0.0)
        if i == 1 and padding == 0.0 and 0 < duration < bar:
            padding = bar - duration  # pickup measure
        ms = MeasureSlices(
            ordinal=i,
            number=f"{m.number}{m.numberSuffix or ''}",
            offset=float(m.offset),
            duration=duration,
            beat_duration=beat,
            padding_left=padding,
        )
        for el in m.recurse().notesAndRests:
            if el.isRest or float(el.quarterLength) <= 0:
                continue
            pitches = list(el.pitches)
            if pitches:
                ms.slices.append(Slice(float(el.offset), float(el.quarterLength), pitches))
        out.append(ms)
    return out


def pitch_class_weights(slices: list[Slice], start: float, end: float) -> list[float]:
    """Duration (in quarters) of each pitch class sounding within [start, end)."""
    weights = [0.0] * 12
    for s in slices:
        overlap = min(end, s.offset + s.duration) - max(start, s.offset)
        if overlap > 0:
            for p in s.pitches:
                weights[p.pitchClass] += overlap
    return weights
