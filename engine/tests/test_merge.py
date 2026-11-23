from score_engine.io.correct import check
from score_engine.omr.merge import merge_pages


def page(divisions: int, notes_per_measure: int, measures: int, first_number: int = 1) -> str:
    """A one-part, one-staff 3/4 page whose measures each hold three quarter notes."""
    quarter = divisions
    body = []
    for i in range(measures):
        attrs = ""
        if i == 0:
            attrs = (
                f"<attributes><divisions>{divisions}</divisions><key><fifths>0</fifths></key>"
                "<time><beats>3</beats><beat-type>4</beat-type></time>"
                "<clef><sign>G</sign><line>2</line></clef></attributes>"
            )
        notes = "".join(
            f"<note><pitch><step>C</step><octave>5</octave></pitch><duration>{quarter}</duration>"
            "<type>quarter</type></note>"
            for _ in range(notes_per_measure)
        )
        body.append(f'<measure number="{first_number + i}">{attrs}{notes}</measure>')
    return (
        '<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"/></part-list>'
        f'<part id="P1">{"".join(body)}</part></score-partwise>'
    )


def test_each_page_keeps_its_divisions():
    """The waltz bug: pages with divisions 6, 4, 6 — page 3 must not inherit page 2's 4."""
    merged = merge_pages([page(6, 3, 2), page(4, 3, 2), page(6, 3, 2)])
    assert merged.count("<divisions>") == 3
    assert check(merged) == []  # every measure is still 3/4


def test_key_time_and_clef_are_not_repeated_at_every_page():
    merged = merge_pages([page(6, 3, 1), page(6, 3, 1)])
    assert merged.count("<time>") == 1
    assert merged.count("<key>") == 1
    assert merged.count("<clef>") == 1


def test_measures_are_renumbered():
    merged = merge_pages([page(2, 3, 2), page(2, 3, 2, first_number=1)])
    import re

    assert re.findall(r'<measure number="(\d+)"', merged) == ["1", "2", "3", "4"]
