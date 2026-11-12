"""Harmonic analysis entry point (the `analyze` JSON-RPC method)."""

from __future__ import annotations

from ..models import Analysis, Chord, KeyRegion
from .common import measure_slices, parse_musicxml
from .harmony import label_chords
from .key import key_regions, tonic_name


def analyze(musicxml: str) -> Analysis:
    score = parse_musicxml(musicxml)
    measures = measure_slices(score)
    regions = key_regions(measures, score)
    labels = label_chords(measures, regions)
    return Analysis(
        key=[
            KeyRegion(
                fromMeasure=r.from_measure,
                toMeasure=r.to_measure,
                tonic=tonic_name(r.key),
                mode=r.key.mode,
                confidence=round(r.confidence, 3),
            )
            for r in regions
        ],
        chords=[
            Chord(
                measure=c.measure,
                beat=c.beat,
                offset=c.offset,
                symbol=c.symbol,
                roman=c.roman,
                function=c.function,  # type: ignore[arg-type]
                confidence=c.confidence,
            )
            for c in labels
        ],
    )
