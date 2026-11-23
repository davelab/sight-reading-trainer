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
    fingers: list[int | None] = field(default_factory=list)  # low to high
    staff: int | None = None  # drawn on the other staff (cross-staff), as printed
    ottava: bool = False  # under an 8va line (the pitch stays as it sounds)


@dataclass
class Bar:
    rh: list[Event]
    lh: list[Event]
    repeat_end: bool = False
    final: bool = False
    text: str = ""  # words above the bar
    repeat_start: bool = False
    times: int = 0  # repeat count at a repeat end
    clefs: list[tuple[int, int, str]] = field(default_factory=list)  # (staff, offset, sign)
    words: list[tuple[int, int, str, str]] = field(
        default_factory=list
    )  # staff, offset, text, place
    dynamic: str = ""  # at the start of the bar, under the right hand
    beam: int = 8  # sixteenths under one beam
    rh2: list[Event] | None = None  # a second voice in a hand (notes held)
    lh2: list[Event] | None = None


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
    heading: str = ""  # the book's own words over the exercise
    notes: str = ""  # its footnotes and remarks
    auto_staff: tuple[int, ...] = ()  # hands (home staff) whose notes go where fewer ledgers
    clefs: tuple[str, str] = ("G", "F")  # at the start
    tempo_words: str = ""  # the metronome mark as the page prints it


def sixteenths(pitches: list[Pitch], fingers: list[int | None] | None = None) -> list[Event]:
    fingers = fingers or []
    out = []
    for i, p in enumerate(pitches):
        f = fingers[i] if i < len(fingers) and fingers[i] else None
        out.append(Event([p], 1, [f] if f else []))
    return out


def sequence(start: Pitch, pattern: list[int], bars: int, step: int) -> list[Bar]:
    """Part I: the pattern from `start` (right hand; the left an octave lower),
    moved one scale step per bar (`step` +1 up, -1 down)."""
    out = []
    for b in range(bars):
        base = start.index + b * step
        rh = [diatonic(base + d) for d in pattern]
        lh = [diatonic(base + d - 7) for d in pattern]
        out.append(Bar(sixteenths(rh), sixteenths(lh)))
    return out


def _apply_layout(bars: list[Bar], number: int) -> None:
    """Staves, fingering and words of each bar as the page prints them."""
    from hanon_layout import ALL1, ALL2, NONE, PART_ONE, per_bar  # noqa: PLC0415

    spec = PART_ONE[number]
    total = spec["bars"]
    rh_staff = per_bar(total, spec["rh_staff"], ALL1)
    lh_staff = per_bar(total, spec["lh_staff"], ALL2)
    rh_f = per_bar(total, spec["rh_f"], NONE)
    lh_f = per_bar(total, spec["lh_f"], NONE)
    for n, bar in enumerate(bars[:total], 1):
        for events, staffs, fingers in ((bar.rh, rh_staff, rh_f), (bar.lh, lh_staff, lh_f)):
            for ev, st, f in zip(events, staffs[n - 1], fingers[n - 1], strict=True):
                ev.staff = int(st)
                ev.fingers = [int(f)] if f != "." else []
        bar.text = spec["words"].get(n, "")
        bar.dynamic = spec["dynamic"].get(n, "")


def part_one(
    number: int,
    description: str,
    asc: list[int],
    asc_start: str,
    asc_bars: int,
    desc: list[int],
    desc_start: str,
    desc_bars: int,
    final_rh: list[str],
    final_lh: list[str],
    page: int,
    final_rh_staff: int = 2,
) -> Exercise:
    from hanon_layout import HEADINGS, NOTES, PART_ONE  # noqa: PLC0415

    bars = sequence(P(asc_start), asc, asc_bars, 1) + sequence(P(desc_start), desc, desc_bars, -1)
    _apply_layout(bars, number)
    bars[-1].repeat_end = True
    spec = PART_ONE[number]
    final = Bar(
        [Event([P(n) for n in final_rh], 8, staff=final_rh_staff)],
        [Event([P(n) for n in final_lh], 8, staff=2)],
        final=True,
    )
    if spec["final_words"]:
        final.words.append((1, 0, spec["final_words"], "above"))
    bars.append(final)
    return Exercise(
        number,
        f"Hanon n. {number}",
        description,
        spec["tempo"] or "♩ = 60–108",
        2,
        4,
        bars,
        str(page),
        heading=HEADINGS.get(number, ""),
        notes=NOTES.get(number, ""),
        tempo_words=spec["tempo"],
    )


# --- writing -------------------------------------------------------------------

CLEF = {"G": ("G", 2), "F": ("F", 4)}
STAFF_RANGE = {"G": (P("E4").index, P("F5").index), "F": (P("G2").index, P("A3").index)}
TYPES = {
    1: "16th",
    2: "eighth",
    3: "eighth",
    4: "quarter",
    6: "quarter",
    8: "half",
    12: "half",
    16: "whole",
}


def _ledgers(pitches: list[Pitch], clef: str, ottava: bool = False) -> int:
    low, high = STAFF_RANGE[clef]
    total = 0
    for p in pitches:
        i = p.index - (7 if ottava else 0)
        total += max(0, (low - i) // 2, (i - high) // 2)
    return total


def _clef_xml(staff: int, sign: str) -> str:
    s, line = CLEF[sign]
    clef = f'<clef number="{staff}"><sign>{s}</sign><line>{line}</line></clef>'
    return f"<attributes>{clef}</attributes>"


def _direction(staff: int, body: str, place: str = "above", extra: str = "") -> str:
    return (
        f'<direction placement="{place}"><direction-type>{body}</direction-type>'
        f"<staff>{staff}</staff>{extra}</direction>"
    )


ACCIDENTAL = {-1: "flat", 0: "natural", 1: "sharp"}


def _note_xml(
    p, ev: Event, staff: int, voice: int, chord: bool, beams: list[str], finger, shown: str = ""
) -> str:
    parts = ["<note>"]
    if chord:
        parts.append("<chord/>")
    if p is None:
        parts.append("<rest/>")
    else:
        alter = f"<alter>{p.alter}</alter>" if p.alter else ""
        parts.append(f"<pitch><step>{p.step}</step>{alter}<octave>{p.octave}</octave></pitch>")
    parts.append(f"<duration>{ev.duration}</duration><voice>{voice}</voice>")
    parts.append(f"<type>{TYPES[ev.duration]}</type>")
    if ev.duration in (3, 6, 12):
        parts.append("<dot/>")
    if shown:
        parts.append(f"<accidental>{shown}</accidental>")
    if p is not None:
        parts.append(f"<stem>{'up' if voice in (1, 3) else 'down'}</stem>")
    parts.append(f"<staff>{staff}</staff>")
    if not chord:
        for k, b in enumerate(beams, 1):
            if b:
                parts.append(f'<beam number="{k}">{b}</beam>')
    if finger:
        place = "above" if voice in (1, 3) else "below"
        parts.append(
            "<notations><technical>"
            f'<fingering placement="{place}">{finger}</fingering>'
            "</technical></notations>"
        )
    parts.append("</note>")
    return "".join(parts)


def _beams(events: list[Event], group: int) -> list[list[str]]:
    """Primary beam over `group` sixteenths (as printed: eight), the second
    beam broken every four."""
    out: list[list[str]] = [[] for _ in events]
    run: list[int] = []

    def flush() -> None:
        for start in range(0, len(run), group):
            chunk = run[start : start + group]
            if len(chunk) < 2:
                continue
            for k, i in enumerate(chunk):
                first = "begin" if k == 0 else "end" if k == len(chunk) - 1 else "continue"
                sub = k % 4
                second = (
                    "begin"
                    if sub == 0
                    else "end"
                    if sub == 3 or k == len(chunk) - 1
                    else "continue"
                )
                if sub == 0 and k == len(chunk) - 1:
                    second = "backward hook"
                out[i] = [first, second if events[i].duration == 1 else ""]
        run.clear()

    for i, e in enumerate(events):
        if e.duration == 1 and e.pitches:
            run.append(i)
        else:
            flush()
    flush()
    return out


class _Writer:
    """Writes the bars, keeping what runs across bar lines: clefs, 8va lines."""

    def __init__(self, ex: Exercise) -> None:
        self.ex = ex
        self.clef = {1: ex.clefs[0], 2: ex.clefs[1]}
        self.shift = {1: False, 3: False, 2: False, 4: False}  # per voice
        self.shift_staff = {1: 1, 2: 1, 3: 1, 4: 1}

    def clef_at(self, bar: Bar, staff: int, offset: int) -> str:
        sign = self.clef[staff]
        for st, at, sg in sorted(bar.clefs, key=lambda c: c[1]):
            if st == staff and at <= offset:
                sign = sg
        return sign

    def staff_of(self, bar: Bar, ev: Event, home: int, offset: int) -> int:
        if ev.staff:
            return ev.staff
        if home not in self.ex.auto_staff or not ev.pitches:
            return home
        here = _ledgers(ev.pitches, self.clef_at(bar, home, offset), ev.ottava)
        other = 2 if home == 1 else 1
        there = _ledgers(ev.pitches, self.clef_at(bar, other, offset), ev.ottava)
        return other if there + 1 < here else home

    def accidental(self, p: Pitch, staff: int) -> str:
        """Shown when the note differs from what the bar (or key) has made it."""
        key = (staff, p.step, p.octave)
        now = self.altered.get(key, 0)
        self.altered[key] = p.alter
        return ACCIDENTAL[p.alter] if p.alter != now else ""

    def voice(self, bar: Bar, events: list[Event], voice: int, home: int, extras: dict) -> str:
        out = []
        t = 0
        beams = _beams(events, bar.beam)
        # A beat goes on one staff (the whole group of four, as the page does).
        staffs = [
            self.staff_of(bar, e, home, sum(x.duration for x in events[:i]))
            for i, e in enumerate(events)
        ]
        for i, ev in enumerate(events):
            for item in extras.get(t, []):
                out.append(item)
            if ev.ottava and not self.shift[voice]:
                staff = staffs[i]
                out.append(_direction(staff, '<octave-shift type="down" size="8"/>'))
                self.shift[voice], self.shift_staff[voice] = True, staff
            elif not ev.ottava and self.shift[voice] and ev.pitches:
                out.append(
                    _direction(self.shift_staff[voice], '<octave-shift type="stop" size="8"/>')
                )
                self.shift[voice] = False
            pitches = sorted(ev.pitches, key=lambda p: p.midi) or [None]
            for k, p in enumerate(pitches):
                finger = ev.fingers[k] if k < len(ev.fingers) else None
                shown = self.accidental(p, staffs[i]) if p is not None else ""
                out.append(_note_xml(p, ev, staffs[i], voice, k > 0, beams[i], finger, shown))
            t += ev.duration
        return "".join(out)

    def close_shifts(self) -> str:
        out = []
        for v, on in self.shift.items():
            if on:
                out.append(_direction(self.shift_staff[v], '<octave-shift type="stop" size="8"/>'))
                self.shift[v] = False
        return "".join(out)

    def measure(self, n: int, bar: Bar, last: bool) -> str:
        ex = self.ex
        beat = 16 // ex.beat_type
        measure_len = beat * ex.beats
        xml = [f'<measure number="{n}">']
        self.altered: dict[tuple[int, str, int], int] = {}
        if bar.repeat_start:
            xml.append(
                '<barline location="left"><bar-style>heavy-light</bar-style>'
                '<repeat direction="forward"/></barline>'
            )
        attrs = []
        if n == 1:
            attrs.append(
                f"<divisions>4</divisions><key><fifths>{ex.fifths}</fifths></key>"
                f"<time><beats>{ex.beats}</beats><beat-type>{ex.beat_type}</beat-type></time>"
                "<staves>2</staves>"
            )
        starting = {st: sg for st, at, sg in bar.clefs if at == 0}
        for staff in (1, 2):
            sign = starting.get(staff, self.clef[staff])
            if n == 1 or sign != self.clef[staff]:
                s, line = CLEF[sign]
                attrs.append(f'<clef number="{staff}"><sign>{s}</sign><line>{line}</line></clef>')
        if attrs:
            xml.append("<attributes>" + "".join(attrs) + "</attributes>")
        if n == 1:
            # The page's own metronome words; the tempo the app plays at.
            body = (
                f"<words>{escape(ex.tempo_words)}</words>"
                if ex.tempo_words
                else '<words print-object="no"> </words>'
            )
            xml.append(_direction(1, body, extra=f'<sound tempo="{ex.bpm}"/>'))
        if bar.text:
            xml.append(_direction(1, f'<words font-style="italic">{escape(bar.text)}</words>'))
        if bar.dynamic:
            xml.append(_direction(1, f"<dynamics><{bar.dynamic}/></dynamics>", "below"))
        # Things placed inside the bar: clef changes and words, by time offset.
        extras: dict[int, dict[int, list[str]]] = {1: {}, 2: {}}
        for staff, at, sign in bar.clefs:
            if at > 0:
                extras[staff].setdefault(at, []).append(_clef_xml(staff, sign))
        for staff, at, text, place in bar.words:
            extras[staff].setdefault(at, []).append(
                _direction(staff, f'<words font-style="italic">{escape(text)}</words>', place)
            )
        voices = [(1, 1, bar.rh), (3, 1, bar.rh2), (2, 2, bar.lh), (4, 2, bar.lh2)]
        first = True
        for voice, home, events in voices:
            if events is None:
                continue
            total = sum(e.duration for e in events)
            if total != measure_len:
                raise ValueError(
                    f"n. {ex.number}, bar {n}, voice {voice}: {total} != {measure_len}"
                )
            if not first:
                xml.append(f"<backup><duration>{measure_len}</duration></backup>")
            first = False
            xml.append(
                self.voice(bar, events, voice, home, extras[home] if voice in (1, 2) else {})
            )
        for staff in {c[0] for c in bar.clefs}:
            self.clef[staff] = self.clef_at(bar, staff, measure_len)
        if last:
            xml.append(self.close_shifts())
        if bar.final:
            xml.append('<barline location="right"><bar-style>light-heavy</bar-style></barline>')
        elif bar.repeat_end:
            extra = f' times="{bar.times}"' if bar.times else ""
            xml.append(
                '<barline location="right"><bar-style>light-heavy</bar-style>'
                f'<repeat direction="backward"{extra}/></barline>'
            )
        xml.append("</measure>")
        return "".join(xml)


def to_musicxml(ex: Exercise) -> str:
    w = _Writer(ex)
    measures = [w.measure(n, bar, n == len(ex.bars)) for n, bar in enumerate(ex.bars, 1)]
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
            ["C3", "E3", "C4"],
            ["C2"],
            20,
            final_rh_staff=2,
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
                "heading": ex.heading,
                "notes": ex.notes,
            }
        )
        print("wrote", name, len(ex.bars), "bars")
    (out / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).parent))
    main()
