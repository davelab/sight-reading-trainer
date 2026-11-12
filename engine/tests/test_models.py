from score_engine.models import Analysis

SPEC_EXAMPLE = {
    "schemaVersion": 1,
    "key": [{"fromMeasure": 1, "toMeasure": 16, "tonic": "G", "mode": "major", "confidence": 0.91}],
    "chords": [{"measure": 3, "beat": 1.0, "symbol": "D7", "roman": "V7", "function": "dominant"}],
    "patterns": [
        {"id": "p1", "kind": "exact", "length": 2, "occurrences": [1, 9, 25]},
        {"id": "p2", "kind": "transposed", "interval": "P4", "length": 4, "occurrences": [5, 13]},
    ],
    "sections": [{"label": "A", "fromMeasure": 1, "toMeasure": 8}],
}


def test_spec_example_round_trips():
    analysis = Analysis.model_validate(SPEC_EXAMPLE)
    dumped = analysis.model_dump(by_alias=True, exclude_none=True)
    assert (
        dumped["chords"][0].pop("offset") == 0.0
    )  # added after the spec: defaults to the downbeat
    assert dumped == SPEC_EXAMPLE
