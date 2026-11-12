"""Walk a MusicXML score note by note, with the position of every note.

Notes are located by musical position, never by ID (CLAUDE.md): the measure
ordinal in the written score, the global staff number (as Verovio numbers
them: the staves of all parts in order), the onset in quarter notes from the
downbeat, and the MIDI pitch.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from fractions import Fraction

STEP_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


@dataclass
class NoteRef:
    measure: int  # 1-based ordinal in the written score
    staff: int  # 1-based global staff number
    offset: Fraction  # quarters from the start of the measure
    midi: int | None  # None for rests


@dataclass
class WalkedNote:
    el: ET.Element
    measure_el: ET.Element
    part_el: ET.Element
    ref: NoteRef
    duration: Fraction  # quarters (0 for grace notes)
    voice: str
    is_chord_member: bool  # has <chord/>: shares the onset of the previous note
    fifths: int  # key signature in force


@dataclass
class MeasureInfo:
    ordinal: int
    label: str  # printed number
    part_index: int
    staves: int
    first_staff: int  # global number of the part's first staff
    expected: Fraction  # quarters per measure from the time signature
    time: tuple[int, int]
    filled: dict[int, Fraction] = field(default_factory=dict)  # global staff -> end of last note


def midi_of(note: ET.Element) -> int | None:
    pitch = note.find("pitch")
    if pitch is None:
        return None
    step = pitch.findtext("step", "C")
    alter = round(float(pitch.findtext("alter", "0") or 0))
    octave = int(pitch.findtext("octave", "4"))
    return 12 * (octave + 1) + STEP_PC.get(step, 0) + alter


def walk(root: ET.Element) -> tuple[list[WalkedNote], list[MeasureInfo]]:
    notes: list[WalkedNote] = []
    measures: list[MeasureInfo] = []
    staff_base = 1
    for part_index, part in enumerate(root.findall("part")):
        divisions = 1
        fifths = 0
        time = (4, 4)
        staves = 1
        for ordinal, measure in enumerate(part.findall("measure"), start=1):
            for attrs in measure.findall("attributes"):
                divisions = int(attrs.findtext("divisions", str(divisions)) or divisions)
                fifths = int(attrs.findtext("key/fifths", str(fifths)) or fifths)
                if attrs.find("time") is not None:
                    beats = attrs.findtext("time/beats", str(time[0]))
                    time = (int(beats.split("+")[0]), int(attrs.findtext("time/beat-type", "4")))
                staves = int(attrs.findtext("staves", str(staves)) or staves)
            info = MeasureInfo(
                ordinal=ordinal,
                label=measure.get("number", str(ordinal)),
                part_index=part_index,
                staves=staves,
                first_staff=staff_base,
                expected=Fraction(time[0] * 4, time[1]),
                time=time,
            )
            pos = Fraction(0)
            last_onset = Fraction(0)
            for el in measure:
                if el.tag in ("backup", "forward"):
                    d = Fraction(int(el.findtext("duration", "0")), divisions)
                    pos += d if el.tag == "forward" else -d
                    continue
                if el.tag != "note":
                    continue
                is_chord = el.find("chord") is not None
                is_grace = el.find("grace") is not None
                dur = (
                    Fraction(0)
                    if is_grace
                    else Fraction(int(el.findtext("duration", "0")), divisions)
                )
                onset = last_onset if is_chord else pos
                staff = staff_base + int(el.findtext("staff", "1")) - 1
                notes.append(
                    WalkedNote(
                        el=el,
                        measure_el=measure,
                        part_el=part,
                        ref=NoteRef(ordinal, staff, onset, midi_of(el)),
                        duration=dur,
                        voice=el.findtext("voice", "1"),
                        is_chord_member=is_chord,
                        fifths=fifths,
                    )
                )
                info.filled[staff] = max(info.filled.get(staff, Fraction(0)), onset + dur)
                if not is_chord:
                    last_onset = pos
                    pos += dur
            measures.append(info)
        staff_base += staves
    return notes, measures
