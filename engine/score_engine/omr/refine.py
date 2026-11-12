"""Second reading of suspicious measures by Claude (vision), on request.

homr reads most of a page well but some textures defeat it: triplets beamed
across the two staves, two voices on one staff. For those measures the review
screen can ask Claude to read the measure again from the page image:

1. suspicious_measures(): measures that do not add up, plus measures whose
   rhythm looks like a misreading (a voice mixing tuplets and plain notes of
   the same value), plus any measure the user picked;
2. one request with the page images, our current reading of each measure and
   a JSON schema for the answer (structured outputs);
3. every measure Claude returns is rebuilt in the MusicXML and kept only if
   it then adds up exactly; otherwise our reading stays, with the reason.

Claude never sees anything but the pages and the measures; the API key comes
from the app (macOS Keychain) with each request and is not stored here.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import re
import xml.etree.ElementTree as ET
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from fractions import Fraction
from math import lcm
from pathlib import Path
from typing import Any

from ..io.correct import _serialize, check
from ..io.xml_walk import MeasureInfo, WalkedNote, walk
from .beams import add_beams

log = logging.getLogger("score_engine.omr.refine")

MODEL = "claude-opus-5-5"
PAGE_DPI = 200  # the API scales large images down; this keeps noteheads legible
MAX_PAGES = 8

TYPES = [
    (Fraction(4), "whole"),
    (Fraction(2), "half"),
    (Fraction(1), "quarter"),
    (Fraction(1, 2), "eighth"),
    (Fraction(1, 4), "16th"),
    (Fraction(1, 8), "32nd"),
    (Fraction(1, 16), "64th"),
]
PITCH = re.compile(r"^([A-G])(#{1,2}|b{1,2})?(-?\d)$")
ALTER = {"": 0, "#": 1, "##": 2, "b": -1, "bb": -2}
ACCIDENTAL = {0: "natural", 1: "sharp", 2: "double-sharp", -1: "flat", -2: "flat-flat"}
STEPS = "CDEFGAB"

SYSTEM = """You read printed piano music. You get page images of a score and, for some \
measures, the reading of an optical music recognition program that may be wrong. \
For each listed measure, read that measure on the page yourself and write out \
everything in it: every note and rest of both staves, with its staff, voice, \
onset and duration.

Conventions for your answer:
- onset and duration are fractions of a quarter note, as strings: "0", "1/2", \
"1/6", "3/2". A sixteenth-note triplet note lasts "1/6", an eighth-note triplet \
note "1/3", a dotted eighth "3/4".
- staff 1 is the upper (treble) staff, staff 2 the lower one. A note sits on \
the staff where it is printed, even when its beam crosses to the other staff.
- voice: 1 or 2 for the upper staff, 3 or 4 for the lower staff, as the stems \
show them; a beamed group that crosses staves keeps one voice for all its notes.
- pitches: ["C#4"], ["Bb3", "D4"] for a chord (sounding pitch, octave 4 starts \
at middle C, accidentals from the key signature and earlier in the measure \
applied); [] for a rest.
- every voice of a staff must fill the whole measure: write its rests too.
- a sign written once and meant to continue ("3" over the first groups only, \
"simile") still applies to the following groups.
Set confident to false for a measure you cannot read clearly; it then stays \
as it is."""

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "measures": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "measure": {"type": "integer"},
                    "confident": {"type": "boolean"},
                    "notes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "staff": {"type": "integer"},
                                "voice": {"type": "integer"},
                                "onset": {"type": "string"},
                                "duration": {"type": "string"},
                                "pitches": {"type": "array", "items": {"type": "string"}},
                            },
                            "required": ["staff", "voice", "onset", "duration", "pitches"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["measure", "confident", "notes"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["measures"],
    "additionalProperties": False,
}


class RefineError(RuntimeError):
    pass


@dataclass
class Outcome:
    musicxml: str
    changed: list[int]
    kept: list[tuple[int, str]]  # measure, why our reading stayed


# --- Which measures -------------------------------------------------------------


def suspicious_measures(musicxml: str) -> list[int]:
    """Measures that do not add up, or whose rhythm looks misread: a voice that
    mixes tuplet and plain notes of the same written value."""
    out = {w.measure for w in check(musicxml)}
    notes, _ = walk(ET.fromstring(musicxml.encode("utf-8")))
    kinds: dict[tuple[int, int, str, str], set[bool]] = defaultdict(set)
    for n in notes:
        type_name = n.el.findtext("type")
        if n.ref.midi is None or not type_name:
            continue
        tuplet = n.el.find("time-modification") is not None
        kinds[(n.ref.measure, n.ref.staff, n.voice, type_name)].add(tuplet)
    out |= {m for (m, *_), seen in kinds.items() if len(seen) == 2}
    return sorted(out)


# --- What we send ---------------------------------------------------------------


def _frac(x: Fraction) -> str:
    return str(x.numerator) if x.denominator == 1 else f"{x.numerator}/{x.denominator}"


def _pitch_name(el: ET.Element) -> str:
    p = el.find("pitch")
    if p is None:
        return ""
    alter = round(float(p.findtext("alter", "0") or 0))
    sign = {1: "#", 2: "##", -1: "b", -2: "bb"}.get(alter, "")
    return f"{p.findtext('step')}{sign}{p.findtext('octave')}"


def describe(musicxml: str, measures: list[int]) -> str:
    """Our current reading of `measures`, one line per voice."""
    root = ET.fromstring(musicxml.encode("utf-8"))
    notes, infos = walk(root)
    by_measure: dict[int, list[WalkedNote]] = defaultdict(list)
    for n in notes:
        by_measure[n.ref.measure].append(n)
    info = {i.ordinal: i for i in infos}
    lines = []
    for m in measures:
        if m not in info:
            continue
        i = info[m]
        lines.append(f"Measure {m} (printed number {i.label}), {i.time[0]}/{i.time[1]}:")
        voices: dict[tuple[int, str], list[str]] = defaultdict(list)
        chords: dict[tuple[int, str, Fraction], list[str]] = defaultdict(list)
        order: list[tuple[int, str, Fraction, Fraction]] = []
        for n in by_measure[m]:
            key = (n.ref.staff, n.voice, n.ref.offset)
            if key not in chords:
                order.append((n.ref.staff, n.voice, n.ref.offset, n.duration))
            chords[key].append(_pitch_name(n.el))
        for staff, voice, onset, duration in order:
            names = [p for p in chords[(staff, voice, onset)] if p]
            what = "+".join(names) if names else "rest"
            voices[(staff, voice)].append(f"{_frac(onset)}:{what}({_frac(duration)})")
        for (staff, voice), items in sorted(voices.items()):
            lines.append(f"  staff {staff} voice {voice}: " + " ".join(items))
    return "\n".join(lines)


def page_images(pdf: Path, pages: list[int]) -> list[str]:
    """PNG (base64) of each page, for the request."""
    import pypdfium2 as pdfium

    doc = pdfium.PdfDocument(str(pdf))
    out = []
    try:
        for n in pages[:MAX_PAGES]:
            buf = io.BytesIO()
            image = doc[n - 1].render(scale=PAGE_DPI / 72).to_pil().convert("L")
            image.save(buf, "PNG", optimize=True)
            out.append(base64.standard_b64encode(buf.getvalue()).decode("ascii"))
    finally:
        doc.close()
    return out


def ask_claude(api_key: str, images: list[str], measures: list[int], reading: str) -> dict:
    """One request: the pages, the measures to read, our reading; returns the parsed JSON."""
    import anthropic

    content: list[dict[str, Any]] = []
    for i, data in enumerate(images, start=1):
        content.append({"type": "text", "text": f"Page {i}:"})
        content.append(
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": data}}
        )
    listed = ", ".join(str(m) for m in measures)
    content.append(
        {
            "type": "text",
            "text": (
                f"Read measures {listed} (counting from the first measure of the piece; "
                "printed measure numbers appear at the start of systems).\n\n"
                f"The recognition program's reading, possibly wrong:\n{reading}"
            ),
        }
    )
    client = anthropic.Anthropic(api_key=api_key, timeout=600.0)
    try:
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=32000,
            system=SYSTEM,
            messages=[{"role": "user", "content": content}],
            output_config={"effort": "high", "format": {"type": "json_schema", "schema": SCHEMA}},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.AuthenticationError as e:
        raise RefineError("chiave API di Claude non valida") from e
    except anthropic.PermissionDeniedError as e:
        raise RefineError("la chiave API non ha accesso a questo modello") from e
    except anthropic.RateLimitError as e:
        raise RefineError("troppe richieste a Claude: riprova tra un minuto") from e
    except anthropic.APIConnectionError as e:
        raise RefineError("Claude non raggiungibile: controlla la connessione") from e
    except anthropic.APIStatusError as e:
        raise RefineError(f"errore di Claude ({e.status_code}): {e.message}") from e
    if response.stop_reason == "refusal":
        raise RefineError("Claude ha rifiutato la richiesta")
    if response.stop_reason == "max_tokens":
        raise RefineError("risposta di Claude troppo lunga: prova con meno battute")
    text = next((b.text for b in response.content if b.type == "text"), "")
    log.info("refine request %s: %s", response._request_id, response.usage)
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise RefineError("risposta di Claude non leggibile") from e


# --- Writing a measure ----------------------------------------------------------


@dataclass
class _Note:
    staff: int
    voice: int
    onset: Fraction
    duration: Fraction
    pitches: list[tuple[str, int, int]]  # step, alter, octave


def _parse_fraction(text: str) -> Fraction:
    try:
        value = Fraction(text.strip())
    except (ValueError, ZeroDivisionError) as e:
        raise ValueError(f"valore non valido: {text!r}") from e
    return value


def _parse_pitch(text: str) -> tuple[str, int, int]:
    m = PITCH.match(text.strip())
    if not m:
        raise ValueError(f"altezza non valida: {text!r}")
    return m[1], ALTER[m[2] or ""], int(m[3])


def _written(duration: Fraction) -> tuple[str, int, bool]:
    """Type name, dots and whether it is a triplet note, for a duration in quarters."""
    for triplet in (False, True):
        value = duration * Fraction(3, 2) if triplet else duration
        for base, name in TYPES:
            for dots, factor in ((0, Fraction(1)), (1, Fraction(3, 2)), (2, Fraction(7, 4))):
                if value == base * factor:
                    return name, dots, triplet
    raise ValueError(f"durata non scrivibile: {_frac(duration)}")


def parse_measure(spec: dict, expected: Fraction, staves: int) -> list[_Note]:
    """Claude's measure, checked: every voice (which may cross staves) runs from the bar
    line to the next without gaps or overlaps, and no staff is empty."""
    notes = []
    for item in spec["notes"]:
        staff = int(item["staff"])
        if not 1 <= staff <= staves:
            raise ValueError(f"pentagramma {staff} inesistente")
        onset, duration = _parse_fraction(item["onset"]), _parse_fraction(item["duration"])
        if onset < 0 or duration <= 0 or onset + duration > expected:
            raise ValueError(f"nota fuori dalla battuta ({item['onset']} + {item['duration']})")
        _written(duration)
        pitches = [_parse_pitch(p) for p in item["pitches"]]
        notes.append(_Note(staff, int(item["voice"]), onset, duration, pitches))
    by_voice: dict[int, list[_Note]] = defaultdict(list)
    for n in notes:
        by_voice[n.voice].append(n)
    for voice, items in by_voice.items():  # a voice may cross staves, never overlap itself
        items.sort(key=lambda n: n.onset)
        for a, b in zip(items, items[1:], strict=False):
            if b.onset < a.onset + a.duration:
                raise ValueError(f"note sovrapposte nella voce {voice} ({_frac(b.onset)})")
        # Rests are written: each voice runs without gaps from the bar line to the next.
        ends = [Fraction(0)] + [n.onset + n.duration for n in items]
        if any(n.onset != end for n, end in zip(items, ends, strict=False)) or ends[-1] != expected:
            raise ValueError(f"la voce {voice} non riempie la battuta")
    for staff in range(1, staves + 1):
        if not any(n.staff == staff for n in notes):
            raise ValueError(f"pentagramma {staff} vuoto")
    return notes


def _key_alters(fifths: int) -> dict[str, int]:
    order_sharp, order_flat = "FCGDAEB", "BEADGCF"
    alters = dict.fromkeys(STEPS, 0)
    for step in order_sharp[:fifths] if fifths > 0 else order_flat[:-fifths]:
        alters[step] = 1 if fifths > 0 else -1
    return alters


def _note_xml(
    note: _Note,
    pitch: tuple[str, int, int] | None,
    chord: bool,
    div: int,
    accidental: str | None,
) -> ET.Element:
    el = ET.Element("note")
    if chord:
        ET.SubElement(el, "chord")
    if pitch is None:
        ET.SubElement(el, "rest")
    else:
        p = ET.SubElement(el, "pitch")
        ET.SubElement(p, "step").text = pitch[0]
        if pitch[1]:
            ET.SubElement(p, "alter").text = str(pitch[1])
        ET.SubElement(p, "octave").text = str(pitch[2])
    ET.SubElement(el, "duration").text = str(int(note.duration * div))
    ET.SubElement(el, "voice").text = str(note.voice)
    type_name, dots, triplet = _written(note.duration)
    ET.SubElement(el, "type").text = type_name
    for _ in range(dots):
        ET.SubElement(el, "dot")
    if accidental:
        ET.SubElement(el, "accidental").text = accidental
    if triplet:
        tm = ET.SubElement(el, "time-modification")
        ET.SubElement(tm, "actual-notes").text = "3"
        ET.SubElement(tm, "normal-notes").text = "2"
    ET.SubElement(el, "staff").text = str(note.staff)
    return el


def _tuplet_marks(items: list[_Note]) -> dict[int, str]:
    """start/stop for each complete triplet group of a voice (three notes' worth)."""
    marks: dict[int, str] = {}
    start, total = None, Fraction(0)
    for i, n in enumerate(items):
        _, _, triplet = _written(n.duration)
        if not triplet:
            start, total = None, Fraction(0)
            continue
        if start is None:
            start, total = i, Fraction(0)
        total += n.duration
        unit = _written_unit(items[start].duration)
        if total == 2 * unit:
            marks[start], marks[i] = "start", "stop"
            start, total = None, Fraction(0)
    return marks


def _written_unit(duration: Fraction) -> Fraction:
    """A triplet's span: two of its written notes."""
    return duration * Fraction(3, 2)


def rebuild_measure(part: ET.Element, measure: ET.Element, notes: list[_Note], fifths: int) -> None:
    """Replace the measure's notes with `notes` (voices one after another)."""
    denominators = [n.onset.denominator for n in notes] + [n.duration.denominator for n in notes]
    div_el = part.find("measure/attributes/divisions")
    if div_el is None:
        raise ValueError("la partitura non dichiara le divisioni")
    div = int(div_el.text or "1")
    need = lcm(div, *denominators)
    if need != div:
        factor = need // div
        for el in part.iter("divisions"):
            el.text = str(int(el.text or "1") * factor)
        for el in part.iter("duration"):
            el.text = str(int(el.text or "0") * factor)
        div = need
    for el in list(measure):
        if el.tag in ("note", "backup", "forward"):
            measure.remove(el)
    tail = [el for el in measure if el.tag == "barline" and el.get("location") != "left"]
    for el in tail:
        measure.remove(el)

    by_voice: dict[int, list[_Note]] = defaultdict(list)
    for n in notes:
        by_voice[n.voice].append(n)
    key = _key_alters(fifths)
    state: dict[tuple[int, str, int], int] = {}  # (staff, step, octave) -> alter in force
    pos = Fraction(0)
    for _voice, items in sorted(by_voice.items()):
        items.sort(key=lambda n: n.onset)
        if pos:
            back = ET.SubElement(measure, "backup")
            ET.SubElement(back, "duration").text = str(int(pos * div))
            pos = Fraction(0)
        marks = _tuplet_marks(items)
        shown = False
        for i, n in enumerate(items):
            if n.onset > pos:
                fwd = ET.SubElement(measure, "forward")
                ET.SubElement(fwd, "duration").text = str(int((n.onset - pos) * div))
            pitches = sorted(n.pitches, key=lambda p: (p[2], STEPS.index(p[0]), p[1])) or [None]
            for j, pitch in enumerate(pitches):
                accidental = None
                if pitch is not None:
                    where = (n.staff, pitch[0], pitch[2])
                    if state.get(where, key[pitch[0]]) != pitch[1]:
                        accidental = ACCIDENTAL[pitch[1]]
                    state[where] = pitch[1]
                el = _note_xml(n, pitch, j > 0, div, accidental)
                if j == 0 and i in marks:
                    notations = ET.SubElement(el, "notations")
                    tuplet = ET.SubElement(notations, "tuplet", type=marks[i], bracket="no")
                    if marks[i] == "start":
                        tuplet.set("show-number", "none" if shown else "actual")
                        shown = True
                measure.append(el)
            pos = n.onset + n.duration
    for el in tail:
        measure.append(el)


# --- The whole step -------------------------------------------------------------


def refine(
    musicxml: str,
    pdf: Path,
    pages: list[int],
    measures: list[int],
    api_key: str,
    ask: Callable[[str, list[str], list[int], str], dict] = ask_claude,
) -> Outcome:
    if not measures:
        return Outcome(musicxml, [], [])
    answer = ask(api_key, page_images(pdf, pages), measures, describe(musicxml, measures))
    root = ET.fromstring(musicxml.encode("utf-8"))
    _, infos = walk(root)
    info: dict[int, MeasureInfo] = {i.ordinal: i for i in infos if i.part_index == 0}
    part = root.find("part")
    if part is None:
        raise RefineError("partitura senza parti")
    fifths_at = _fifths_by_measure(part)
    changed: list[int] = []
    kept: list[tuple[int, str]] = []
    returned = {int(m["measure"]): m for m in answer.get("measures", [])}
    for m in measures:
        spec = returned.get(m)
        if spec is None:
            kept.append((m, "Claude non l'ha riletta"))
            continue
        if not spec.get("confident", False):
            kept.append((m, "Claude non è sicuro della lettura"))
            continue
        try:
            notes = parse_measure(spec, info[m].expected, info[m].staves)
            trial = ET.fromstring(ET.tostring(root))
            trial_part = trial.find("part")
            assert trial_part is not None
            rebuild_measure(trial_part, trial_part.findall("measure")[m - 1], notes, fifths_at[m])
        except (ValueError, KeyError) as e:
            kept.append((m, f"lettura di Claude scartata: {e}"))
            continue
        if any(w.measure == m for w in check(_serialize(trial))):
            kept.append((m, "con la lettura di Claude la battuta non torna"))
            continue
        root = trial
        changed.append(m)
    xml = _serialize(root)
    return Outcome(add_beams(xml) if changed else xml, changed, kept)


def _fifths_by_measure(part: ET.Element) -> dict[int, int]:
    out, fifths = {}, 0
    for ordinal, measure in enumerate(part.findall("measure"), start=1):
        for f in measure.iter("fifths"):
            fifths = int(f.text or "0")
        out[ordinal] = fifths
    return out
