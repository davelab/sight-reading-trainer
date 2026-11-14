import re
import xml.etree.ElementTree as ET

from score_engine.omr.beams import add_beams


def score(notes: str, beats: int = 4, beat_type: int = 4, divisions: int = 6) -> str:
    return (
        '<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"/></part-list>'
        f'<part id="P1"><measure number="1"><attributes><divisions>{divisions}</divisions>'
        f"<time><beats>{beats}</beats><beat-type>{beat_type}</beat-type></time></attributes>"
        f"{notes}</measure></part></score-partwise>"
    )


def note(duration: int, kind: str, step: str = "C", extra: str = "", rest: bool = False) -> str:
    what = "<rest/>" if rest else f"<pitch><step>{step}</step><octave>5</octave></pitch>"
    body = f"<duration>{duration}</duration><voice>1</voice><type>{kind}</type>{extra}"
    return f"<note>{what}{body}</note>"


def beams(xml: str) -> list[list[tuple[str, str]]]:
    root = ET.fromstring(xml.encode())
    return [[(b.get("number"), b.text) for b in n.findall("beam")] for n in root.iter("note")]


def test_eighths_are_beamed_in_pairs_per_beat():
    out = add_beams(score(note(3, "eighth") * 8))
    assert beams(out) == [[("1", "begin")], [("1", "end")]] * 4


def test_eighth_and_two_sixteenths():
    out = add_beams(score(note(2, "eighth") + note(1, "16th") * 2, beats=1, divisions=4))
    assert beams(out) == [
        [("1", "begin")],
        [("1", "continue"), ("2", "begin")],
        [("1", "end"), ("2", "end")],
    ]


def test_lone_sixteenth_gets_a_hook():
    dotted = note(3, "eighth", extra="<dot/>")
    out = add_beams(score(note(1, "16th") + dotted, beats=1, divisions=4))
    assert beams(out) == [[("1", "begin"), ("2", "forward hook")], [("1", "end")]]


def test_running_sixteenths():
    out = add_beams(score(note(1, "16th") * 4, beats=1, divisions=4))
    assert beams(out) == [
        [("1", "begin"), ("2", "begin")],
        [("1", "continue"), ("2", "continue")],
        [("1", "continue"), ("2", "continue")],
        [("1", "end"), ("2", "end")],
    ]


def test_sixteenth_triplets_beamed_by_beat_without_brackets():
    tm = (
        "<time-modification><actual-notes>3</actual-notes>"
        "<normal-notes>2</normal-notes></time-modification>"
    )
    first = tm + '<notations><tuplet type="start"/></notations>'
    last = tm + '<notations><tuplet type="stop"/></notations>'
    six = (
        note(1, "16th", extra=first) + note(1, "16th", extra=tm) + note(1, "16th", extra=last)
    ) * 2
    out = add_beams(score(six, beats=1))
    assert [b[0] for b in beams(out)] == [("1", "begin")] + [("1", "continue")] * 4 + [("1", "end")]
    assert 'bracket="no"' in out


def test_rests_break_groups_and_lone_notes_stay_flagged():
    out = add_beams(
        score(note(3, "eighth", rest=True) + note(3, "eighth") + note(6, "quarter") * 3)
    )
    assert beams(out) == [[], [], [], [], []]


def test_existing_beams_are_kept():
    beamed = note(3, "eighth", extra='<beam number="1">begin</beam>') + note(
        3, "eighth", extra='<beam number="1">end</beam>'
    )
    out = add_beams(score(beamed + note(6, "quarter") * 3))
    assert len(re.findall("<beam", out)) == 2


def test_compound_time_groups_by_dotted_quarter():
    out = add_beams(score(note(3, "eighth") * 6, beats=6, beat_type=8))
    assert [b[0][1] for b in beams(out)] == ["begin", "continue", "end"] * 2
