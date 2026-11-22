"""Hanon, The Virtuoso Pianist (Schirmer edition, 1900, public domain): selected
exercises written out as MusicXML for the app's Exercises view.

The exercises are sequences: one bar pattern moved a scale step at a time, up
then down. Each one is described here by what the printed page shows (pattern,
first and last bars, fingering of the first bar each way, final chord), read
from the scanned edition, and written out in full. Run:

    cd engine && uv run python ../scripts/hanon/hanon.py ../app/src/assets/hanon

The right hand stays on the upper staff and the left on the lower one (the app
tells the hands apart by staff), with clef changes where a hand goes far.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from xml.sax.saxutils import escape

STEPS = "CDEFGAB"
SEMITONE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


@dataclass(frozen=True)
class Pitch:
    step: str
    alter: int
    octave: int

    @property
    def midi(self) -> int:
        return 12 * (self.octave + 1) + SEMITONE[self.step] + self.alter

    @property
    def index(self) -> int:  # diatonic index, C0 = 0
        return self.octave * 7 + STEPS.index(self.step)


def P(name: str) -> Pitch:
    """'C4', 'Bb3', 'F#5'."""
    step, rest = name[0], name[1:]
    alter = 0
    while rest and rest[0] in "#b":
        alter += 1 if rest[0] == "#" else -1
        rest = rest[1:]
    return Pitch(step, alter, int(rest))


def diatonic(index: int) -> Pitch:
    """A white key (C major) from its diatonic index."""
    return Pitch(STEPS[index % 7], 0, index // 7)


@dataclass
class Event:
    pitches: list[Pitch]  # empty: a rest
    duration: int  # in divisions (4 per quarter: a sixteenth is 1)
    fingers: list[int] = field(default_factory=list)  # one per pitch, low to high, or none


@dataclass
class Bar:
    rh: list[Event]
    lh: list[Event]
    repeat_end: bool = False
    final: bool = False
    text: str = ""  # a direction above the bar ("4 volte")
    repeat_start: bool = False
    times: int = 0  # repeat count shown at a repeat end ("4 volte")


@dataclass
class Exercise:
    number: int
    title: str
    description: str
    tempo: str
    beats: int
    beat_type: int
    bars: list[Bar]
    pages: str
    bpm: int = 60
    fifths: int = 0


def sixteenths(pitches: list[Pitch], fingers: list[int | None] | None = None) -> list[Event]:
    fingers = fingers or []
    out = []
    for i, p in enumerate(pitches):
        f = fingers[i] if i < len(fingers) and fingers[i] else None
        out.append(Event([p], 1, [f] if f else []))
    return out


def sequence(
    start: Pitch,
    pattern: list[int],
    bars: int,
    step: int,
    rh_fingers: list[int | None] | None = None,
    lh_fingers: list[int | None] | None = None,
) -> list[Bar]:
    """Part I: the pattern from `start` (right hand; the left an octave lower),
    moved one scale step per bar (`step` +1 up, -1 down). Fingering on the
    first bar only, as printed."""
    out = []
    for b in range(bars):
        base = start.index + b * step
        rh = [diatonic(base + d) for d in pattern]
        lh = [diatonic(base + d - 7) for d in pattern]
        out.append(
            Bar(
                sixteenths(rh, rh_fingers if b == 0 else None),
                sixteenths(lh, lh_fingers if b == 0 else None),
            )
        )
    return out


def part_one(
    number: int,
    description: str,
    asc: list[int],
    asc_start: str,
    asc_bars: int,
    desc: list[int],
    desc_start: str,
    desc_bars: int,
    fingers: dict[str, list[int | None]],
    final_rh: list[str],
    final_lh: list[str],
    page: int,
) -> Exercise:
    bars = sequence(P(asc_start), asc, asc_bars, 1, fingers.get("asc_rh"), fingers.get("asc_lh"))
    down = sequence(
        P(desc_start), desc, desc_bars, -1, fingers.get("desc_rh"), fingers.get("desc_lh")
    )
    down[0].text = "discendendo"
    bars[0].text = "ascendendo"
    bars += down
    bars[-1].repeat_end = True
    bars.append(
        Bar(
            [Event([P(n) for n in final_rh], 8)],
            [Event([P(n) for n in final_lh], 8)],
            final=True,
        )
    )
    return Exercise(
        number,
        f"Hanon n. {number}",
        description,
        "♩ = 60–108",
        2,
        4,
        bars,
        str(page),
    )


# --- writing -------------------------------------------------------------------

CLEF = {"G": ("G", 2), "F": ("F", 4)}


STAFF_RANGE = {"G": (P("E4").index, P("F5").index), "F": (P("G2").index, P("A3").index)}
OTTAVA_FROM = P("A5").midi  # a right-hand beat entirely this high is printed 8va


def _ledgers(events: list[Event], clef: str, ottava: bool = False) -> int:
    low, high = STAFF_RANGE[clef]
    total = 0
    for e in events:
        for p in e.pitches:
            i = p.index - (7 if ottava else 0)
            total += max(0, (low - i) // 2, (i - high) // 2)
    return total


def _clef_for(events: list[Event], current: str) -> str:
    """The clef that needs fewer ledger lines, keeping the current one unless the
    other is clearly better (no clef flipping back and forth)."""
    other = "F" if current == "G" else "G"
    return other if _ledgers(events, other) + 2 < _ledgers(events, current) else current


def _clefs_by_beat(events: list[Event], current: str, beat: int) -> list[str]:
    """The clef for each beat of a bar (a hand may change clef mid-bar, as the
    printed page does when a scale runs across middle C)."""
    out, t, i = [], 0, 0
    while i < len(events):
        group = []
        while i < len(events) and t // beat == len(out):
            group.append(events[i])
            t += events[i].duration
            i += 1
        current = _clef_for(group, current)
        out.append(current)
    return out


def _clef_xml(staff: int, sign: str) -> str:
    s, line = CLEF[sign]
    clef = f'<clef number="{staff}"><sign>{s}</sign><line>{line}</line></clef>'
    return f"<attributes>{clef}</attributes>"


def _note_xml(p: Pitch | None, ev: Event, staff: int, voice: int, chord: bool, beam: str, finger):
    parts = ["<note>"]
    if chord:
        parts.append("<chord/>")
    if p is None:
        parts.append("<rest/>")
    else:
        alter = f"<alter>{p.alter}</alter>" if p.alter else ""
        parts.append(f"<pitch><step>{p.step}</step>{alter}<octave>{p.octave}</octave></pitch>")
    parts.append(f"<duration>{ev.duration}</duration><voice>{voice}</voice>")
    kind = {
        1: "16th",
        2: "eighth",
        3: "eighth",
        4: "quarter",
        6: "quarter",
        8: "half",
        12: "half",
        16: "whole",
    }[ev.duration]
    parts.append(f"<type>{kind}</type>")
    if ev.duration in (3, 6, 12):
        parts.append("<dot/>")
    if p is not None and p.alter:
        parts.append(f"<accidental>{'sharp' if p.alter > 0 else 'flat'}</accidental>")
    parts.append(f"<stem>{'up' if voice == 1 else 'down'}</stem>")
    parts.append(f"<staff>{staff}</staff>")
    if beam and not chord:
        parts.append(f'<beam number="1">{beam}</beam>')
        if ev.duration == 1:
            parts.append(f'<beam number="2">{beam}</beam>')
    if finger:
        parts.append(
            "<notations><technical>"
            f'<fingering placement="{"above" if voice == 1 else "below"}">{finger}</fingering>'
            "</technical></notations>"
        )
    parts.append("</note>")
    return "".join(parts)


def _ottava_beats(events: list[Event], beat: int) -> list[bool]:
    """Beats of the right hand printed 8va: every note from A5 up."""
    out, t = [], 0
    groups: dict[int, list[int]] = {}
    for e in events:
        groups.setdefault(t // beat, []).extend(p.midi for p in e.pitches)
        t += e.duration
    for b in range(max(groups) + 1 if groups else 0):
        notes = groups.get(b, [])
        out.append(bool(notes) and min(notes) >= OTTAVA_FROM)
    # A bracket over a single beat helps no one: at least two beats in a row.
    return [
        on and ((i > 0 and out[i - 1]) or (i + 1 < len(out) and out[i + 1]))
        for i, on in enumerate(out)
    ]


def _shift(kind: str) -> str:
    return (
        '<direction placement="above"><direction-type>'
        f'<octave-shift type="{kind}" size="8"/></direction-type><staff>1</staff></direction>'
    )


def _voice_xml(
    events: list[Event],
    staff: int,
    voice: int,
    beat: int,
    clefs: list[str] | None = None,
    ottava: list[bool] | None = None,
) -> str:
    """One hand's bar; `clefs` (one per beat) puts clef changes inside the bar,
    `ottava` (one per beat) the 8va brackets (pitches stay as they sound)."""
    out = []
    t = 0
    shifted = False
    for i, ev in enumerate(events):
        b = t // beat
        if clefs and t % beat == 0 and b > 0 and clefs[b] != clefs[b - 1]:
            out.append(_clef_xml(staff, clefs[b]))
        if ottava and t % beat == 0:
            if ottava[b] and not shifted:
                out.append(_shift("down"))
                shifted = True
            elif not ottava[b] and shifted:
                out.append(_shift("stop"))
                shifted = False
        beam = ""
        if ev.duration < 4 and ev.pitches:
            group = t // beat
            mates = [
                j
                for j, e in enumerate(events)
                if e.duration < 4
                and e.pitches
                and sum(x.duration for x in events[:j]) // beat == group
            ]
            if len(mates) > 1:
                beam = "begin" if i == mates[0] else "end" if i == mates[-1] else "continue"
        pitches = sorted(ev.pitches, key=lambda p: p.midi) or [None]
        for k, p in enumerate(pitches):
            finger = ev.fingers[k] if k < len(ev.fingers) else None
            out.append(_note_xml(p, ev, staff, voice, k > 0, beam, finger))
        t += ev.duration
    if shifted:
        out.append(_shift("stop"))
    return "".join(out)


def to_musicxml(ex: Exercise) -> str:
    beat = 16 // ex.beat_type  # divisions per beat
    measure_len = beat * ex.beats
    clefs = {1: "G", 2: "F"}
    measures = []
    for n, bar in enumerate(ex.bars, 1):
        xml = [f'<measure number="{n}">']
        if bar.repeat_start:
            xml.append(
                '<barline location="left"><bar-style>heavy-light</bar-style>'
                '<repeat direction="forward"/></barline>'
            )
        by_beat = {
            1: _clefs_by_beat(bar.rh, clefs[1], beat),
            2: _clefs_by_beat(bar.lh, clefs[2], beat),
        }
        wanted = {1: by_beat[1][0], 2: by_beat[2][0]}
        attrs = []
        if n == 1:
            attrs.append(
                f"<divisions>4</divisions><key><fifths>{ex.fifths}</fifths></key>"
                f"<time><beats>{ex.beats}</beats><beat-type>{ex.beat_type}</beat-type></time>"
                "<staves>2</staves>"
            )
        for staff in (1, 2):
            if n == 1 or wanted[staff] != clefs[staff]:
                sign, line = CLEF[wanted[staff]]
                attrs.append(
                    f'<clef number="{staff}"><sign>{sign}</sign><line>{line}</line></clef>'
                )
        for staff in (1, 2):
            clefs[staff] = by_beat[staff][-1]
        if attrs:
            xml.append("<attributes>" + "".join(attrs) + "</attributes>")
        if n == 1:
            xml.append(
                '<direction placement="above"><direction-type><metronome>'
                "<beat-unit>quarter</beat-unit>"
                f"<per-minute>{ex.bpm}</per-minute></metronome></direction-type>"
                f'<staff>1</staff><sound tempo="{ex.bpm}"/></direction>'
            )
        if bar.text:
            xml.append(
                '<direction placement="above"><direction-type>'
                f'<words font-style="italic">{escape(bar.text)}</words></direction-type>'
                "<staff>1</staff></direction>"
            )
        for hand, events in ((1, bar.rh), (2, bar.lh)):
            total = sum(e.duration for e in events)
            if total != measure_len:
                raise ValueError(f"n. {ex.number}, bar {n}, hand {hand}: {total} != {measure_len}")
            if hand == 2:
                xml.append(f"<backup><duration>{measure_len}</duration></backup>")
            # MusicXML keeps the sounding pitch; an 8va is only how it is printed.
            ottava = _ottava_beats(events, beat) if hand == 1 else None
            xml.append(_voice_xml(events, hand, hand, beat, by_beat[hand], ottava))
        if bar.final:
            xml.append('<barline location="right"><bar-style>light-heavy</bar-style></barline>')
        elif bar.repeat_end:
            extra = f' times="{bar.times}"' if bar.times else ""
            xml.append(
                '<barline location="right"><bar-style>light-heavy</bar-style>'
                f'<repeat direction="backward"{extra}/></barline>'
            )
        xml.append("</measure>")
        measures.append("".join(xml))
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" '
        '"http://www.musicxml.org/dtds/partwise.dtd">\n'
        '<score-partwise version="4.0">'
        f"<work><work-title>{escape(ex.title)}</work-title></work>"
        '<identification><creator type="composer">Charles-Louis Hanon</creator>'
        "<rights>Public domain (The Virtuoso Pianist, Schirmer 1900)</rights></identification>"
        '<part-list><score-part id="P1"><part-name print-object="no">Pianoforte</part-name>'
        "</score-part></part-list>"
        '<part id="P1">' + "".join(measures) + "</part></score-partwise>\n"
    )


# --- the exercises ---------------------------------------------------------------


def exercises() -> list[Exercise]:
    from hanon_parts import advanced  # noqa: PLC0415 - Part II and III, separate file

    out = [
        part_one(
            1,
            "Estensione tra 4° e 5° dito; indipendenza e uniformità di 3, 4, 5.",
            [0, 2, 3, 4, 5, 4, 3, 2],
            "C3",
            14,
            [0, -2, -3, -4, -5, -4, -3, -2],
            "G5",
            15,
            {
                "asc_rh": [1, 2, 3, 4, 5],
                "asc_lh": [5, 4, 3, 2, 1],
                "desc_rh": [5, 4, 3, 2, 1],
                "desc_lh": [1, 2, 3, 4, 5],
            },
            ["C3"],
            ["C2"],
            1,
        ),
        part_one(
            2,
            "Rafforza 3° e 4° dito; posizione estesa con il 5°.",
            [0, 2, 5, 4, 3, 4, 3, 2],
            "C3",
            14,
            [0, -3, -5, -4, -3, -4, -3, -2],
            "G5",
            14,
            {
                "asc_rh": [1, 2, 5, 4, 3, 4, 3, 2],
                "asc_lh": [5, 3, 1, 2, 3, 2, 3, 4],
                "desc_rh": [5, 2, 1, 2, 3, 2, 3, 4],
                "desc_lh": [1, 3, 5, 4, 3, 4, 3, 2],
            },
            ["C3"],
            ["C2"],
            2,
        ),
        part_one(
            13,
            "Esercizio per 3°, 4° e 5° dito, a note alternate.",
            [2, 0, 3, 1, 4, 2, 3, 4],
            "C3",
            14,
            [-2, 0, -3, -1, -2, -4, -3, -2],
            "G5",
            14,
            {
                "asc_rh": [3, 1, 4, 2, 5, 3, 4, 5],
                "asc_lh": [3, 5, 2, 4, 1, 3, 2, 1],
                "desc_rh": [3, 5, 2, 4, 3, 1, 3, 4],
                "desc_lh": [3, 1, 4, 2, 3, 5, 3, 2],
            },
            ["C3"],
            ["C2"],
            13,
        ),
        part_one(
            20,
            "Estensione 2-4 e 4-5; esercizio per 2°, 3°, 4° dito su un arpeggio largo.",
            [0, 2, 5, 7, 5, 4, 5, 3],
            "E3",
            15,
            [0, -2, -5, -7, -5, -6, -5, -7],
            "E6",
            15,
            {
                "asc_rh": [1, 2, 4, 5, 4, 3, 4, 2],
                "asc_lh": [5, 4, 2, 1, 2, 3, 2, 4],
                "desc_rh": [5, 4, 2, 1, 3, 2, 3, 1],
                "desc_lh": [1, 2, 4, 5, 3, 4, 3, 5],
            },
            ["C3", "E3", "C4"],
            ["C2"],
            20,
        ),
    ]
    return out + advanced()


def main() -> None:
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    index = []
    for ex in exercises():
        name = f"hanon-{ex.number:02d}.musicxml"
        (out / name).write_text(to_musicxml(ex), encoding="utf-8")
        index.append(
            {
                "number": ex.number,
                "title": ex.title,
                "description": ex.description,
                "tempo": ex.tempo,
                "bpm": ex.bpm,
                "file": name,
                "measures": len(ex.bars),
                "page": ex.pages,
            }
        )
        print("wrote", name, len(ex.bars), "bars")
    (out / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).parent))
    main()
