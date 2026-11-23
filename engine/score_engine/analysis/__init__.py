"""Harmonic analysis entry point (the `analyze` JSON-RPC method)."""

from __future__ import annotations

from ..models import Analysis, Chord, KeyRegion, Pattern
from .common import measure_slices, parse_musicxml
from .harmony import label_chords
from .key import key_regions, tonic_name
from .patterns import find_patterns, interval_name


def analyze(musicxml: str) -> Analysis:
    score = parse_musicxml(musicxml)
    measures = measure_slices(score)
    regions = key_regions(measures, score)
    labels = label_chords(measures, regions)
    found = find_patterns(score)
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
        patterns=[_pattern(i, f) for i, f in enumerate(found, start=1)],
    )


def _pattern(index: int, f) -> Pattern:
    transpositions = [interval_name(f.anchors[0], a) for a in f.anchors]
    moved = next((t for t in transpositions if t != "P1"), None)
    return Pattern(
        id=f"p{index}",
        kind=f.kind,
        length=f.length,
        occurrences=[s + 1 for s in f.starts],  # measure ordinals are 1-based
        hands=f.scope,
        interval=moved if f.kind == "transposed" else None,
        transpositions=transpositions if f.kind == "transposed" else None,
    )
