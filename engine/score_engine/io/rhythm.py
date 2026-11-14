"""Rhythm corrections of a recognised score: durations, dots, triplets, inserted
notes, chords joined or split, and deletions that remove time.

The MusicXML this works on is written one voice after another, separated by
<backup> (as omr/symbols.py writes it, and as most writers do). When a note
gets longer or shorter by `d`, the notes after it in its voice move by `d`
and the <backup> that ends the voice changes by `d` too, so the other voices
keep their place. Divisions grow when a new duration needs it (triplets).
"""

from __future__ import annotations

import copy
import xml.etree.ElementTree as ET
from fractions import Fraction

from .xml_walk import WalkedNote

TYPE_QUARTERS = {
    "whole": Fraction(4),
    "half": Fraction(2),
    "quarter": Fraction(1),
    "eighth": Fraction(1, 2),
    "16th": Fraction(1, 4),
    "32nd": Fraction(1, 8),
    "64th": Fraction(1, 16),
}
# MusicXML <note> children that come before <time-modification> / <dot>.
BEFORE_TIME_MOD = {"grace", "cue", "chord", "pitch", "unpitched", "rest", "duration", "tie",
                   "instrument", "voice", "type", "dot", "accidental"}  # fmt: skip


class RhythmError(ValueError):
    pass


def _quarters(note: ET.Element) -> Fraction:
    """Written value of a note in quarters, from type, dots and time modification."""
    q = TYPE_QUARTERS.get(note.findtext("type", "quarter"), Fraction(1))
    dots = len(note.findall("dot"))
    q *= 2 - Fraction(1, 2**dots)
    tm = note.find("time-modification")
    if tm is not None:
        q *= Fraction(int(tm.findtext("normal-notes", "1")), int(tm.findtext("actual-notes", "1")))
    return q


def _group(target: WalkedNote) -> list[ET.Element]:
    """The chord the note belongs to: head first, then its <chord/> members."""
    children = list(target.measure_el)
    i = children.index(target.el)
    while i > 0 and children[i].find("chord") is not None:
        i -= 1
    group = [children[i]]
    for c in children[i + 1 :]:
        if c.tag == "note" and c.find("chord") is not None:
            group.append(c)
        else:
            break
    return group


def _voice_heads(target: WalkedNote) -> list[ET.Element]:
    """Chord heads (or single notes and rests) of the target's voice in its measure, in order."""
    voice = target.voice
    staff = target.el.findtext("staff", "1")
    return [
        c
        for c in target.measure_el
        if c.tag == "note"
        and c.find("chord") is None
        and c.find("grace") is None
        and c.findtext("voice", "1") == voice
        and c.findtext("staff", "1") == staff
    ]


def _divisions_el(part: ET.Element) -> ET.Element:
    el = part.find("measure/attributes/divisions")
    if el is None:
        raise RhythmError("la partitura non dichiara le divisioni")
    return el


def _ensure_divisions(part: ET.Element, quarters: Fraction) -> int:
    """Make `quarters` a whole number of divisions, scaling the part if needed."""
    div_el = _divisions_el(part)
    div = int(div_el.text or "1")
    factor = (quarters * div).denominator
    if factor == 1:
        return div
    for el in part.iter("divisions"):
        el.text = str(int(el.text or "1") * factor)
    for el in part.iter("duration"):
        el.text = str(int(el.text or "0") * factor)
    return div * factor


def _shift_voice_end(target_el: ET.Element, measure: ET.Element, delta: int) -> None:
    """The voice got `delta` divisions longer: so does the <backup> that ends it."""
    if delta == 0:
        return
    children = list(measure)
    for c in children[children.index(target_el) + 1 :]:
        if c.tag == "backup":
            d = c.find("duration")
            assert d is not None
            d.text = str(max(0, int(d.text or "0") + delta))
            return


def _set_value(note: ET.Element, quarters: Fraction, div: int) -> int:
    """Set <duration> from the written value; returns the change in divisions."""
    d = note.find("duration")
    if d is None:
        return 0
    old = int(d.text or "0")
    new = int(quarters * div)
    d.text = str(new)
    return new - old


def _insert_child(note: ET.Element, el: ET.Element) -> None:
    index = max((i + 1 for i, c in enumerate(note) if c.tag in BEFORE_TIME_MOD), default=0)
    note.insert(index, el)


def _strip_tuplets(note: ET.Element) -> None:
    for n in note.findall("notations"):
        for t in n.findall("tuplet"):
            n.remove(t)
        if len(n) == 0:
            note.remove(n)


def _retime_group(group: list[ET.Element], change, part: ET.Element) -> int:
    """Apply `change(note)` to every note of a chord and update durations; returns delta."""
    for n in group:
        change(n)
    div = _ensure_divisions(part, _quarters(group[0]))
    delta = 0
    for i, n in enumerate(group):
        d = _set_value(n, _quarters(n), div)
        if i == 0:
            delta = d
    return delta


def set_type(target: WalkedNote, type_name: str) -> ET.Element:
    if type_name not in TYPE_QUARTERS:
        raise RhythmError(f"durata sconosciuta: {type_name}")
    group = _group(target)

    def change(n: ET.Element) -> None:
        t = n.find("type")
        if t is None:
            t = ET.Element("type")
            _insert_child(n, t)
        t.text = type_name
        for dot in n.findall("dot"):
            n.remove(dot)

    _shift_voice_end(group[-1], target.measure_el, _retime_group(group, change, target.part_el))
    return target.el


def toggle_dot(target: WalkedNote) -> ET.Element:
    group = _group(target)
    dotted = group[0].find("dot") is not None

    def change(n: ET.Element) -> None:
        for dot in n.findall("dot"):
            n.remove(dot)
        if not dotted:
            _insert_child(n, ET.Element("dot"))

    _shift_voice_end(group[-1], target.measure_el, _retime_group(group, change, target.part_el))
    return target.el


def _make_triplet(n: ET.Element) -> None:
    if n.find("time-modification") is None:
        tm = ET.Element("time-modification")
        ET.SubElement(tm, "actual-notes").text = "3"
        ET.SubElement(tm, "normal-notes").text = "2"
        _insert_child(n, tm)


def _mark_tuplet(head: ET.Element, kind: str) -> None:
    notations = head.find("notations")
    if notations is None:
        notations = ET.SubElement(head, "notations")
    notations.insert(0, ET.Element("tuplet", type=kind))


def triplets(target: WalkedNote, whole_measure: bool) -> ET.Element:
    """Make triplets: the three notes from the selected one, or every note of its value
    in its voice and measure (grouped in threes)."""
    heads = _voice_heads(target)
    group0 = _group(target)
    start = heads.index(group0[0])
    if whole_measure:
        kind = group0[0].findtext("type")
        chosen = [
            h for h in heads if h.findtext("type") == kind and h.find("time-modification") is None
        ]
    else:
        chosen = [h for h in heads[start : start + 3] if h.find("time-modification") is None]
        if len(chosen) < 3:
            raise RhythmError("servono tre note dalla nota selezionata in poi, nella stessa voce")
    if not chosen:
        raise RhythmError("nessuna nota da trasformare in terzina")
    children = list(target.measure_el)
    total = 0
    for h in chosen:
        members = []  # chord members directly after the head
        for c in children[children.index(h) + 1 :]:
            if c.tag == "note" and c.find("chord") is not None:
                members.append(c)
            else:
                break
        g = [h, *members]
        for n in g:
            _strip_tuplets(n)
        total += _retime_group(g, _make_triplet, target.part_el)
    for i in range(0, len(chosen) - 2, 3):
        _mark_tuplet(chosen[i], "start")
        _mark_tuplet(chosen[i + 2], "stop")
    last = chosen[-1]
    members_after = [c for c in list(target.measure_el)[list(target.measure_el).index(last) + 1 :]]
    end = last
    for c in members_after:
        if c.tag == "note" and c.find("chord") is not None:
            end = c
        else:
            break
    _shift_voice_end(end, target.measure_el, total)
    return target.el


def insert_after(target: WalkedNote) -> ET.Element:
    """A copy of the selected note right after its chord (same pitch and value)."""
    group = _group(target)
    new = copy.deepcopy(group[0] if target.el is group[0] else target.el)
    for tag in ("chord", "beam", "notations", "tie", "lyric"):
        for c in new.findall(tag):
            new.remove(c)
    children = list(target.measure_el)
    target.measure_el.insert(children.index(group[-1]) + 1, new)
    d = new.find("duration")
    _shift_voice_end(new, target.measure_el, int(d.text or "0") if d is not None else 0)
    return new


def toggle_chord(target: WalkedNote) -> ET.Element:
    """A chord member becomes the next note in time; a single note joins the previous chord."""
    measure = target.measure_el
    el = target.el
    d = el.find("duration")
    dur = int(d.text or "0") if d is not None else 0
    if el.find("chord") is not None:
        rest_of_chord = [n for n in _group(target) if n is not el]
        measure.remove(el)
        el.remove(el.find("chord"))  # type: ignore[arg-type]
        children = list(measure)
        measure.insert(children.index(rest_of_chord[-1]) + 1, el)
        _shift_voice_end(el, measure, dur)
        return el
    heads = _voice_heads(target)
    i = heads.index(el)
    if i == 0:
        raise RhythmError("non c'è una nota precedente nella voce a cui unirla")
    if el.find("rest") is not None or heads[i - 1].find("rest") is not None:
        raise RhythmError("una pausa non può far parte di un accordo")
    el.insert(0, ET.Element("chord"))
    _shift_voice_end(el, measure, -dur)
    return el


def delete_with_time(target: WalkedNote) -> ET.Element | None:
    """Remove the note and its time: what follows in the voice moves earlier."""
    measure = target.measure_el
    el = target.el
    children = list(measure)
    following = children[children.index(el) + 1] if children.index(el) + 1 < len(children) else None
    if el.find("chord") is not None:
        measure.remove(el)
        return None
    if following is not None and following.tag == "note" and following.find("chord") is not None:
        following.remove(following.find("chord"))  # type: ignore[arg-type]
        measure.remove(el)
        return following
    d = el.find("duration")
    dur = int(d.text or "0") if d is not None else 0
    _shift_voice_end(el, measure, -dur)
    measure.remove(el)
    return None


def octave(target: WalkedNote, step: int) -> ET.Element:
    o = target.el.find("pitch/octave")
    if o is None:
        raise RhythmError("si possono spostare d'ottava solo le note")
    o.text = str(int(o.text or "4") + step)
    return target.el
