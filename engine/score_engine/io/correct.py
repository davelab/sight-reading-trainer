"""Corrections of a recognised (OMR) score, and checks that point at its likely errors.

Edits are applied to the MusicXML text itself, so everything the recogniser
wrote is preserved. A note is found by position (measure, staff, onset, pitch).
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from fractions import Fraction

from ..models import EditAction, OmrWarning
from .xml_walk import STEP_PC, MeasureInfo, NoteRef, WalkedNote, midi_of, walk

STEPS = "CDEFGAB"
SHARPS_ORDER = "FCGDAEB"


class EditError(ValueError):
    pass


def _parse(musicxml: str) -> ET.Element:
    try:
        return ET.fromstring(musicxml.encode("utf-8"))
    except ET.ParseError as e:
        raise EditError(f"MusicXML non valido: {e}") from e


def _serialize(root: ET.Element) -> str:
    body = ET.tostring(root, encoding="unicode")
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" '
        '"http://www.musicxml.org/dtds/partwise.dtd">\n' + body + "\n"
    )


def key_alter(step: str, fifths: int) -> int:
    """Alteration the key signature gives to `step` (+1 sharp, -1 flat)."""
    if fifths > 0 and step in SHARPS_ORDER[:fifths]:
        return 1
    if fifths < 0 and step in SHARPS_ORDER[::-1][:-fifths]:
        return -1
    return 0


def find_note(notes: list[WalkedNote], ref: NoteRef) -> WalkedNote:
    for n in notes:
        r = n.ref
        if (r.measure, r.staff, r.midi) == (ref.measure, ref.staff, ref.midi) and abs(
            r.offset - ref.offset
        ) < Fraction(1, 96):
            return n
    raise EditError(
        f"nota non trovata (battuta {ref.measure}, pentagramma {ref.staff}, "
        f"tempo {float(ref.offset):g}, altezza {ref.midi})"
    )


def _set_pitch(note: ET.Element, step: str, octave: int, alter: int, fifths: int) -> None:
    pitch = note.find("pitch")
    assert pitch is not None
    pitch.find("step").text = step  # type: ignore[union-attr]
    pitch.find("octave").text = str(octave)  # type: ignore[union-attr]
    alter_el = pitch.find("alter")
    if alter:
        if alter_el is None:
            alter_el = ET.Element("alter")
            pitch.insert(1, alter_el)
        alter_el.text = str(alter)
    elif alter_el is not None:
        pitch.remove(alter_el)
    # Show an accidental only where the key signature does not imply it.
    acc = note.find("accidental")
    if acc is not None:
        note.remove(acc)
    if alter != key_alter(step, fifths):
        acc = ET.Element("accidental")
        acc.text = {1: "sharp", -1: "flat", 0: "natural", 2: "double-sharp", -2: "flat-flat"}[alter]
        # MusicXML order: ... type, dot, accidental, time-modification, stem ...
        anchor = next(
            (i + 1 for i, c in reversed(list(enumerate(note))) if c.tag in ("type", "dot")),
            len(note),
        )
        note.insert(anchor, acc)


def _delete(walked: WalkedNote, notes: list[WalkedNote]) -> None:
    note, measure = walked.el, walked.measure_el
    siblings = list(measure)
    idx = siblings.index(note)
    following = siblings[idx + 1] if idx + 1 < len(siblings) else None
    chord_follows = (
        following is not None and following.tag == "note" and following.find("chord") is not None
    )
    if walked.is_chord_member or chord_follows:
        # Part of a chord: drop just this pitch. If it led the chord, the next one leads.
        if not walked.is_chord_member and following is not None:
            chord = following.find("chord")
            if chord is not None:
                following.remove(chord)
        measure.remove(note)
        return
    # A single note becomes a rest of the same duration.
    for tag in ("pitch", "accidental", "stem", "beam", "tie", "notations", "lyric", "notehead"):
        for child in note.findall(tag):
            note.remove(child)
    rest = ET.Element("rest")
    first = next((i for i, c in enumerate(note) if c.tag not in ("grace", "cue")), 0)
    note.insert(first, rest)


def apply_edit(musicxml: str, ref: NoteRef, action: EditAction) -> str:
    root = _parse(musicxml)
    notes, _ = walk(root)
    target = find_note(notes, ref)
    note = target.el
    if action == "delete":
        _delete(target, notes)
        return _serialize(root)
    pitch = note.find("pitch")
    if pitch is None:
        raise EditError("si possono modificare solo le note, non le pause")
    step = pitch.findtext("step", "C")
    octave = int(pitch.findtext("octave", "4"))
    alter = round(float(pitch.findtext("alter", "0") or 0))
    if action in ("step-up", "step-down"):
        i = STEPS.index(step) + (1 if action == "step-up" else -1)
        octave += i // 7
        step = STEPS[i % 7]
        alter = key_alter(step, target.fifths)  # a moved note follows the key signature
    elif action == "sharp":
        alter = 1
    elif action == "flat":
        alter = -1
    elif action == "natural":
        alter = 0
    else:
        raise EditError(f"azione sconosciuta: {action}")
    _set_pitch(note, step, octave, alter, target.fifths)
    assert midi_of(note) == 12 * (octave + 1) + STEP_PC[step] + alter
    return _serialize(root)


def _fmt(quarters: Fraction, beat_type: int) -> str:
    in_beats = quarters * beat_type / 4
    if in_beats.denominator == 1:
        return f"{in_beats.numerator}/{beat_type}"
    whole = quarters / 4
    return f"{whole.numerator}/{whole.denominator}"


def _staff_name(info: MeasureInfo, staff: int, parts: int) -> str:
    local = staff - info.first_staff + 1
    if info.staves == 2:
        return "m. destra" if local == 1 else "m. sinistra"
    return f"parte {info.part_index + 1}" if parts > 1 else ""


def check(musicxml: str) -> list[OmrWarning]:
    """Measures whose notes do not add up to the time signature: the usual OMR error.

    A shorter first measure (pickup) and last measure are normal and not reported.
    """
    root = _parse(musicxml)
    _, measures = walk(root)
    parts = len(root.findall("part"))
    last = max((m.ordinal for m in measures), default=0)
    warnings: list[OmrWarning] = []
    for info in measures:
        for staff in range(info.first_staff, info.first_staff + info.staves):
            filled = info.filled.get(staff, Fraction(0))
            if filled == 0 or filled == info.expected:
                continue
            if filled < info.expected and info.ordinal in (1, last):
                continue
            who = _staff_name(info, staff, parts)
            what = "troppo piena" if filled > info.expected else "incompleta"
            beat_type = info.time[1]
            warnings.append(
                OmrWarning(
                    measure=info.ordinal,
                    staff=staff,
                    kind="duration",
                    message=(
                        f"Battuta {info.label}{f' ({who})' if who else ''}: {what}, "
                        f"{_fmt(filled, beat_type)} invece di {_fmt(info.expected, beat_type)}"
                    ),
                )
            )
    return warnings
