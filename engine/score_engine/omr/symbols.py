"""homr's recognised symbols → MusicXML, with our own timing.

homr recognises each staff system as a sequence of symbols (note_16 E5
upper, chord, note_2 C4 lower, barline, ...). Its own MusicXML writer
places them in time through the voice label the model gives each note
(upper, lower, lower2); when the model mislabels one, the writer inserts a
wrong <forward> and every following note of the measure moves. On a page of
running sixteenths (BWV 846, BWV 851a) that broke most measures although
almost every pitch and duration was right.

Here the timing does not depend on those labels:
- "chord" joins a symbol to the previous one (same onset);
- any other note or rest starts when the earliest note still sounding ends
  (the sequence is in time order, and every voice writes its rests);
- a symbol after grace notes starts with them.
Then each staff is split into voices again: notes with the same onset and
duration form a chord, and each chord goes into the first voice free at its
onset. The time signature's top number, which homr does not read, comes
from the measures' actual length.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from collections import Counter
from dataclasses import dataclass, field
from fractions import Fraction
from math import lcm
from typing import Protocol

BARLINES = {
    "barline",
    "doublebarline",
    "bolddoublebarline",
    "repeatStart",
    "repeatEnd",
    "repeatEndStart",
}
LIFT_TO_ALTER = {"N": 0, "#": 1, "##": 2, "b": -1, "bb": -2}
TYPE_NAMES = {
    Fraction(2): "breve",
    Fraction(1): "whole",
    Fraction(1, 2): "half",
    Fraction(1, 4): "quarter",
    Fraction(1, 8): "eighth",
    Fraction(1, 16): "16th",
    Fraction(1, 32): "32nd",
    Fraction(1, 64): "64th",
    Fraction(1, 128): "128th",
}
ARTICULATIONS = {"staccato", "accent", "tenuto", "staccatissimo"}


class Symbol(Protocol):
    rhythm: str
    pitch: str
    lift: str
    articulation: str
    slur: str
    position: str


@dataclass(frozen=True)
class Duration:
    value: Fraction  # in whole notes; 0 for grace notes
    base: Fraction  # written value, e.g. 1/16
    dots: int
    actual: int = 1
    normal: int = 1
    grace: bool = False
    whole_measure: bool = False


def parse_duration(kern: str) -> Duration:
    """homr's **kern durations: '16', '8.', '24' (16th triplet), '8G' (grace), '0' (bar rest)."""
    if kern.endswith("m"):  # multi-measure rest: one measure here
        return Duration(Fraction(1), Fraction(1), 0, whole_measure=True)
    digits = re.match(r"\d*", kern).group(0)  # type: ignore[union-attr]
    base = int(digits) if digits else 4
    dots = kern.count(".")
    grace = "G" in kern
    if base == 0:
        return Duration(Fraction(1), Fraction(1), dots, whole_measure=True)
    if base & (base - 1) == 0:
        written, actual, normal = Fraction(1, base), 1, 1
    else:  # tuplet: 24 = sixteenth triplet (3 in the time of 2)
        normal = 1 << (base.bit_length() - 1)
        written = Fraction(1, normal)
        ratio = Fraction(base, normal)
        actual, normal = ratio.numerator, ratio.denominator
    value = written * (2 - Fraction(1, 2**dots)) * Fraction(normal, actual)
    return Duration(Fraction(0) if grace else value, written, dots, actual, normal, grace)


def staff_of(position: str) -> int:
    return 2 if position.startswith("lower") else 1


@dataclass
class Event:
    onset: Fraction
    duration: Duration
    staff: int
    pitch: str | None  # "E4"; None for a rest
    alter: int | None
    articulation: str
    slur: str
    voice: int = 0
    chord: bool = False
    tie: list[str] = field(default_factory=list)


@dataclass
class Measure:
    events: list[Event] = field(default_factory=list)
    symbols: list = field(default_factory=list)  # the measure's own symbols, for re-timing
    # (onset, staff, element) for clefs and dynamics met inside the measure
    marks: list[tuple[Fraction, int, ET.Element]] = field(default_factory=list)
    key: int | None = None
    time_denominator: int | None = None
    bar_style: str | None = None

    @property
    def length(self) -> Fraction:
        return max((e.onset + e.duration.value for e in self.events), default=Fraction(0))


def _clef(rhythm: str, staff: int) -> ET.Element:
    sign, line = rhythm.split("_")[1][0], rhythm.split("_")[1][1:]
    clef = ET.Element("clef", number=str(staff))
    ET.SubElement(clef, "sign").text = "percussion" if sign == "T" else sign
    ET.SubElement(clef, "line").text = line or "2"
    return clef


def to_measures(symbols: list[Symbol]) -> tuple[list[Measure], dict[int, ET.Element]]:
    """Split a part's symbols into measures with timed events. Returns them and the first clefs."""
    measures: list[Measure] = [Measure()]
    first_clefs: dict[int, ET.Element] = {}
    joined = False  # the next symbol shares the previous onset ("chord")
    onset = Fraction(0)
    last_was_grace = False
    for s in symbols:
        m = measures[-1]
        r = s.rhythm
        if r not in BARLINES:
            m.symbols.append(s)
        if r == "chord":
            joined = True
            continue
        if r in BARLINES:
            m.bar_style = r
            measures.append(Measure())
            onset, joined, last_was_grace = Fraction(0), False, False
            continue
        if r.startswith("clef_"):
            staff = staff_of(s.position)
            clef = _clef(r, staff)
            if not m.events and len(measures) == 1:
                first_clefs[staff] = clef
            else:
                m.marks.append((_next_onset(m, onset, joined), staff, clef))
            joined = False
            continue
        if r.startswith("keySignature_"):
            m.key = int(r.split("_")[1])
            continue
        if r.startswith("timeSignature/"):
            m.time_denominator = int(r.split("/")[1])
            continue
        if r.startswith("dynamic_"):
            direction = ET.Element("direction", placement="below")
            dtype = ET.SubElement(direction, "direction-type")
            dyn = ET.SubElement(dtype, "dynamics")
            ET.SubElement(dyn, r.split("_", 1)[1])
            m.marks.append((_next_onset(m, onset, joined), staff_of(s.position), direction))
            continue
        if not r.startswith(("note_", "rest_")):
            continue  # volta and other symbols we do not render
        d = parse_duration(r.split("_", 1)[1])
        if not joined and m.events:
            onset = onset if last_was_grace else _next_onset(m, onset, False)
        joined = False
        last_was_grace = d.grace
        is_note = r.startswith("note_") and s.pitch not in ("", "_", ".")
        m.events.append(
            Event(
                onset=onset,
                duration=d,
                staff=staff_of(s.position),
                pitch=s.pitch if is_note else None,
                alter=LIFT_TO_ALTER.get(s.lift) if is_note else None,
                articulation=s.articulation or "",
                slur=s.slur or "",
            )
        )
    if not measures[-1].events and len(measures) > 1:
        measures.pop()
    return measures, first_clefs


@dataclass
class _Untupled:
    """A symbol with its tuplet removed (24 -> 16, 12 -> 8...), as homr's own repair does."""

    rhythm: str
    pitch: str
    lift: str
    articulation: str
    slur: str
    position: str


def _untuple(s: Symbol) -> Symbol:
    m = re.match(r"(note|rest)_(\d+)(.*)", s.rhythm)
    if not m:
        return s
    base = int(m[2])
    if base == 0 or base & (base - 1) == 0:
        return s
    for k, n in ((3, 2), (5, 4), (7, 4)):
        if base % k == 0:
            base = base // k * n
            break
    else:
        return s
    return _Untupled(f"{m[1]}_{base}{m[3]}", s.pitch, s.lift, s.articulation, s.slur, s.position)


def repair_tuplets(measures: list[Measure], expected: Fraction) -> int:
    """Measures that do not add up but would without their tuplets: the model read plain
    notes as tuplets. Re-time them without; returns how many were repaired."""
    repaired = 0
    for m in measures:
        has_tuplets = any(e.duration.actual != e.duration.normal for e in m.events)
        if m.length == expected or not has_tuplets:
            continue
        retimed = to_measures([_untuple(s) for s in m.symbols])[0][0]
        if retimed.length == expected:
            m.events = retimed.events
            m.marks = retimed.marks
            repaired += 1
    return repaired


def _next_onset(m: Measure, onset: Fraction, joined: bool) -> Fraction:
    """When the next group starts: as the earliest note still sounding ends."""
    if joined or not m.events:
        return onset
    ends = [e.onset + e.duration.value for e in m.events if e.onset + e.duration.value > onset]
    return min(ends) if ends else onset


def assign_voices(m: Measure, first_voice: dict[int, int]) -> None:
    """Chords = same staff, onset and duration; each goes to the first voice free at its onset."""
    groups: dict[tuple, list[Event]] = {}
    for e in m.events:
        key = (e.staff, e.onset, e.duration, e.pitch is None, e.duration.grace)
        if e.pitch is None:
            key = key + (id(e),)  # a rest is never part of a chord
        groups.setdefault(key, []).append(e)
    ends: dict[int, list[Fraction]] = {}
    for (staff, onset, duration, *_), events in sorted(
        groups.items(), key=lambda kv: (kv[0][0], kv[0][1], kv[0][3])
    ):
        voices = ends.setdefault(staff, [])
        free = [i for i, end in enumerate(voices) if end <= onset]
        # Prefer the voice that ends exactly here: it continues without a gap.
        exact = [i for i in free if voices[i] == onset]
        index = (exact or free or [len(voices)])[0]
        if index == len(voices):
            voices.append(Fraction(0))
        voices[index] = onset + duration.value
        for i, e in enumerate(sorted(events, key=lambda e: _midi(e.pitch, e.alter))):
            e.voice = first_voice[staff] + index
            e.chord = i > 0


def _midi(pitch: str | None, alter: int | None) -> int:
    if not pitch:
        return -1
    steps = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
    return 12 * (int(pitch[1:]) + 1) + steps[pitch[0]] + (alter or 0)


def _divisions(measures: list[Measure]) -> int:
    """Smallest number of divisions per quarter that makes every duration whole."""
    div = 1
    for m in measures:
        for e in m.events:
            for v in (e.onset, e.duration.value):
                div = lcm(div, (v * 4).denominator)
    return div


def _beats(measures: list[Measure], denominator: int) -> int:
    """Top number of the time signature: the most common measure length."""
    lengths = Counter(m.length for m in measures if m.length > 0)
    if not lengths:
        return 4
    common = lengths.most_common(1)[0][0]
    beats = common * denominator
    return beats.numerator if beats.denominator == 1 and beats.numerator > 0 else 4


def _note_element(e: Event, div: int, tuplet: str | None, show_number: bool = True) -> ET.Element:
    note = ET.Element("note")
    if e.duration.grace:
        ET.SubElement(note, "grace")
    if e.chord:
        ET.SubElement(note, "chord")
    if e.pitch is None:
        rest = ET.SubElement(note, "rest")
        if e.duration.whole_measure:
            rest.set("measure", "yes")
    else:
        pitch = ET.SubElement(note, "pitch")
        ET.SubElement(pitch, "step").text = e.pitch[0]
        if e.alter:
            ET.SubElement(pitch, "alter").text = str(e.alter)
        ET.SubElement(pitch, "octave").text = e.pitch[1:]
    if not e.duration.grace:
        ET.SubElement(note, "duration").text = str(int(e.duration.value * 4 * div))
    for t in e.tie:
        ET.SubElement(note, "tie", type=t)
    ET.SubElement(note, "voice").text = str(e.voice)
    if not e.duration.whole_measure:
        ET.SubElement(note, "type").text = TYPE_NAMES.get(e.duration.base, "quarter")
        for _ in range(e.duration.dots):
            ET.SubElement(note, "dot")
    if e.duration.actual != e.duration.normal:
        tm = ET.SubElement(note, "time-modification")
        ET.SubElement(tm, "actual-notes").text = str(e.duration.actual)
        ET.SubElement(tm, "normal-notes").text = str(e.duration.normal)
    ET.SubElement(note, "staff").text = str(e.staff)
    notations = ET.Element("notations")
    for t in e.tie:
        ET.SubElement(notations, "tied", type=t)
    if tuplet:
        t = ET.SubElement(notations, "tuplet", type=tuplet)
        if not show_number:
            t.set("show-number", "none")
    parts = set(e.articulation.split("_"))
    if "fermata" in parts:
        ET.SubElement(notations, "fermata")
    arts = [a for a in ARTICULATIONS if a in parts]
    if arts:
        art = ET.SubElement(notations, "articulations")
        for a in sorted(arts):
            ET.SubElement(art, a)
    if len(notations):
        note.append(notations)
    return note


def _mark_ties(measures: list[Measure]) -> None:
    """A slur from a note to the very next note of the same pitch on its staff is a tie."""
    last: dict[int, Event] = {}
    for m in measures:
        for e in sorted(m.events, key=lambda e: (e.onset, e.staff)):
            if e.pitch is None or e.duration.grace:
                continue
            prev = last.get(e.staff)
            if (
                prev is not None
                and "slurStart" in prev.slur
                and "slurStop" in e.slur
                and (prev.pitch, prev.alter) == (e.pitch, e.alter)
            ):
                prev.tie.append("start")
                e.tie.append("stop")
            last[e.staff] = e


def _tuplet_marks(voice_events: list[Event]) -> dict[int, str]:
    """start/stop on each complete tuplet group of a voice (e.g. three triplet sixteenths)."""
    marks: dict[int, str] = {}
    group: list[Event] = []
    total = Fraction(0)
    for e in voice_events:
        d = e.duration
        if d.actual == d.normal or e.chord:
            if not e.chord:
                group, total = [], Fraction(0)
            continue
        group.append(e)
        total += d.value
        if total >= d.base * d.normal:
            if len(group) > 1:
                marks[id(group[0])] = "start"
                marks[id(group[-1])] = "stop"
            group, total = [], Fraction(0)
    return marks


def part_to_measures_xml(symbols: list[Symbol], part: ET.Element) -> None:
    measures, first_clefs = to_measures(symbols)
    staves = 2 if any(e.staff == 2 for m in measures for e in m.events) or 2 in first_clefs else 1
    first_voice = {1: 1, 2: 5}
    denominator = next((m.time_denominator for m in measures if m.time_denominator), None)
    beats = _beats(measures, denominator or 4)
    if denominator:
        repair_tuplets(measures, Fraction(beats, denominator))
    for m in measures:
        assign_voices(m, first_voice)
    _mark_ties(measures)
    div = _divisions(measures)

    # Engraving convention: a tuplet number is printed where a run of tuplets
    # starts and left out while the following measures continue it ("sempre").
    had_tuplets: dict[int, bool] = {}
    for number, m in enumerate(measures, start=1):
        el = ET.SubElement(part, "measure", number=str(number))
        tuplet_staves = {e.staff for e in m.events if e.duration.actual != e.duration.normal}
        if number == 1:
            attrs = ET.SubElement(el, "attributes")
            ET.SubElement(attrs, "divisions").text = str(div)
            key = ET.SubElement(attrs, "key")
            ET.SubElement(key, "fifths").text = str(m.key or 0)
            if denominator:
                time = ET.SubElement(attrs, "time")
                ET.SubElement(time, "beats").text = str(beats)
                ET.SubElement(time, "beat-type").text = str(denominator)
            if staves == 2:
                ET.SubElement(attrs, "staves").text = "2"
            for staff in sorted(first_clefs):
                attrs.append(first_clefs[staff])
        elif m.key is not None:
            attrs = ET.SubElement(el, "attributes")
            key = ET.SubElement(attrs, "key")
            ET.SubElement(key, "fifths").text = str(m.key)

        voices: dict[int, list[Event]] = {}
        for e in sorted(m.events, key=lambda e: (e.onset, e.chord)):
            voices.setdefault(e.voice, []).append(e)
        for vi, voice in enumerate(sorted(voices)):
            events = voices[voice]
            tuplets = _tuplet_marks(events)
            staff = events[0].staff
            marks = sorted(
                (
                    mk
                    for mk in m.marks
                    if mk[1] == staff
                    and voice == min(v for v in voices if voices[v][0].staff == staff)
                ),
                key=lambda mk: mk[0],
            )
            pos = Fraction(0)
            for e in events:
                if not e.chord:
                    while marks and marks[0][0] <= e.onset:
                        onset, _, mark = marks.pop(0)
                        if onset > pos:
                            _forward(el, onset - pos, div, voice, staff)
                            pos = onset
                        _append_mark(el, mark)
                    if e.onset > pos:
                        _forward(el, e.onset - pos, div, voice, staff)
                        pos = e.onset
                show = not had_tuplets.get(e.staff, False)
                el.append(_note_element(e, div, tuplets.get(id(e)), show))
                if not e.chord:
                    pos = e.onset + e.duration.value
            for _, _, mark in marks:
                _append_mark(el, mark)
            if vi < len(voices) - 1 and pos > 0:
                back = ET.SubElement(el, "backup")
                ET.SubElement(back, "duration").text = str(int(pos * 4 * div))
        had_tuplets = {staff: staff in tuplet_staves for staff in (1, 2)}
        if m.bar_style in ("doublebarline", "bolddoublebarline", "repeatEnd", "repeatEndStart"):
            bar = ET.SubElement(el, "barline", location="right")
            style = {"doublebarline": "light-light"}.get(m.bar_style, "light-heavy")
            ET.SubElement(bar, "bar-style").text = style
            if m.bar_style.startswith("repeatEnd"):
                ET.SubElement(bar, "repeat", direction="backward")


def _forward(el: ET.Element, gap: Fraction, div: int, voice: int, staff: int) -> None:
    fwd = ET.SubElement(el, "forward")
    ET.SubElement(fwd, "duration").text = str(int(gap * 4 * div))
    ET.SubElement(fwd, "voice").text = str(voice)
    ET.SubElement(fwd, "staff").text = str(staff)


def _append_mark(el: ET.Element, mark: ET.Element) -> None:
    if mark.tag == "clef":
        attrs = ET.SubElement(el, "attributes")
        attrs.append(mark)
    else:
        el.append(mark)


def symbols_to_musicxml(parts: list[list[Symbol]], title: str = "") -> str:
    root = ET.Element("score-partwise", version="4.0")
    if title:
        work = ET.SubElement(root, "work")
        ET.SubElement(work, "work-title").text = title
    ident = ET.SubElement(root, "identification")
    enc = ET.SubElement(ident, "encoding")
    ET.SubElement(enc, "software").text = "Score Studio (homr symbols)"
    part_list = ET.SubElement(root, "part-list")
    for i, symbols in enumerate(parts, start=1):
        sp = ET.SubElement(part_list, "score-part", id=f"P{i}")
        ET.SubElement(sp, "part-name").text = "Piano" if i == 1 else f"Parte {i}"
        part = ET.SubElement(root, "part", id=f"P{i}")
        part_to_measures_xml(symbols, part)
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode") + "\n"
