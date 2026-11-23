"""Automatic beaming for recognised scores.

homr writes no <beam> elements, so every eighth and sixteenth gets its own
flag and every triplet its own bracket: a page of running sixteenths then
looks nothing like the PDF and takes several times the space. This adds
beams the usual way, only to voices that have none:
- notes shorter than a quarter are grouped by beat (a quarter in simple
  time, a dotted quarter in 6/8, 9/8, 12/8); rests and longer notes break
  the group;
- one beam for eighths, a second for sixteenths, and so on; a lone shorter
  note in a group gets a hook toward its neighbour;
- a beamed tuplet shows its number without a bracket.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from fractions import Fraction

from ..io.xml_walk import WalkedNote, walk

LEVELS = {"eighth": 1, "16th": 2, "32nd": 3, "64th": 4, "128th": 5}
# MusicXML <note> children that come before <beam>.
BEFORE_BEAM = {
    "grace", "cue", "chord", "pitch", "unpitched", "rest", "duration", "tie", "instrument",
    "voice", "type", "dot", "accidental", "time-modification", "stem", "notehead",
    "notehead-text", "staff",
}  # fmt: skip


def _beat_length(beats: int, beat_type: int) -> Fraction:
    if beat_type == 8 and beats % 3 == 0 and beats > 3:
        return Fraction(3, 2)  # compound time: dotted quarter
    return Fraction(1)


def _insert_beam(note: ET.Element, number: int, value: str) -> None:
    beam = ET.Element("beam", number=str(number))
    beam.text = value
    index = max((i + 1 for i, c in enumerate(note) if c.tag in BEFORE_BEAM | {"beam"}), default=0)
    note.insert(index, beam)


def _beam_group(group: list[WalkedNote]) -> None:
    levels = [LEVELS[n.el.findtext("type", "")] for n in group]
    for level in range(1, max(levels) + 1):
        i = 0
        while i < len(group):
            if levels[i] < level:
                i += 1
                continue
            j = i
            while j + 1 < len(group) and levels[j + 1] >= level:
                j += 1
            if j > i:
                for k in range(i, j + 1):
                    value = "begin" if k == i else "end" if k == j else "continue"
                    _insert_beam(group[k].el, level, value)
            else:  # a lone shorter note: hook toward the group
                _insert_beam(group[i].el, level, "forward hook" if i == 0 else "backward hook")
            i = j + 1
    for n in group:
        for tuplet in n.el.findall("notations/tuplet"):
            tuplet.set("bracket", "no")


def add_beams(musicxml: str) -> str:
    root = ET.fromstring(musicxml.encode("utf-8"))
    notes, measures = walk(root)
    times = {(m.part_index, m.ordinal): m.time for m in measures}
    part_index = {id(p): i for i, p in enumerate(root.findall("part"))}

    voices: dict[tuple, list[WalkedNote]] = {}
    for n in notes:
        if n.is_chord_member or n.el.find("grace") is not None:
            continue
        key = (id(n.measure_el), n.ref.staff, n.voice)
        voices.setdefault(key, []).append(n)

    for voice in voices.values():
        if any(n.el.find("beam") is not None for n in voice):
            continue  # already beamed by the writer: leave it alone
        part = part_index[id(voice[0].part_el)]
        beat = _beat_length(*times[(part, voice[0].ref.measure)])
        group: list[WalkedNote] = []
        current_beat = None
        for n in sorted(voice, key=lambda n: n.ref.offset):
            beamable = n.el.find("rest") is None and n.el.findtext("type", "") in LEVELS
            this_beat = int(n.ref.offset // beat)
            if not beamable or this_beat != current_beat:
                if len(group) > 1:
                    _beam_group(group)
                group = []
                current_beat = this_beat
            if beamable:
                group.append(n)
        if len(group) > 1:
            _beam_group(group)

    body = ET.tostring(root, encoding="unicode")
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + body + "\n"
