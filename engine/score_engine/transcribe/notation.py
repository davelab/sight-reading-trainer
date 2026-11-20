"""Transcribed notes -> a readable score (MusicXML) that follows the performance's
own pulse, so rubato is absorbed by the beat grid instead of becoming odd rhythms.

1. beats from the notes (beats.py), each note placed in beat coordinates;
2. meter (2, 3 or 4 beats) and downbeat where the accents fall (bass, chords,
   loudness);
3. per beat, sixteenths or triplets, whichever fits the notes' positions
   better; onsets and offsets snapped to it;
4. hands split by pitch, at the widest gap near middle C in each measure;
5. music21 builds measures, ties and rests; key from the notes, pitches
   spelled in that key; tempo from the median beat.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from fractions import Fraction

import numpy as np

from ..models import TranscribeHints
from .beats import to_beats, track_beats
from .postprocess import NoteEvent, PedalEvent

# Grids a beat can be written in, with the error (in beats) a grid must save over
# the plain sixteenths to be chosen: a finer grid always fits a little better,
# only notes actually played on it should earn it.
GRIDS = {
    Fraction(1, 4): 0.0,  # sixteenths (and eighths)
    Fraction(1, 3): 0.02,  # triplet eighths
    Fraction(1, 8): 0.06,  # thirty-seconds
    Fraction(1, 6): 0.04,  # sextuplets (triplet sixteenths)
}


@dataclass
class Placed:
    onset: Fraction  # in beats from the first downbeat
    end: Fraction
    pitch: int
    velocity: int
    hand: int = 1  # 1 right, 2 left


HALF_TIME_ABOVE = 140.0  # bpm: a faster beat is written as half as many beats


def half_time(beats: np.ndarray, notes: list[NoteEvent]) -> np.ndarray:
    """A pulse this fast is the subdivision (eighths of a ballad, a rag's
    sixteenths-and-eighths), rarely the beat it is written in: keep every other
    beat, on the phase that carries the accents."""
    if len(beats) < 4 or 60 / float(np.median(np.diff(beats))) <= HALF_TIME_ABOVE:
        return beats
    acc = beat_accents(beats, notes)
    phase = 0 if acc[0::2].sum() >= acc[1::2].sum() else 1
    return beats[phase::2]


SLIP_COST = 4.0  # in units of the median accent: a measure of the wrong length is rare


def beat_accents(beats: np.ndarray, notes: list[NoteEvent]) -> np.ndarray:
    """Accent of each beat: loudness of the attacks on it, bass and chords weigh more."""
    acc = np.zeros(len(beats))
    x = to_beats(np.array([n.onset for n in notes]), beats)
    for n, b in zip(notes, x, strict=True):
        i = int(round(b))
        if 0 <= i < len(beats) and abs(b - i) < 0.15:
            acc[i] += (n.velocity / 127) * (2.0 if n.pitch < 55 else 1.0)
    return acc


def _downbeat_path(
    acc: np.ndarray, meter: int, anchor: int | None = None
) -> tuple[float, list[int]]:
    """Viterbi over positions in the measure (0 = downbeat). Each beat moves to the
    next position; restarting a measure early or late costs SLIP_COST. `anchor`:
    a beat known to be a downbeat (from the pickup the user gave)."""
    scale = float(np.median(acc[acc > 0])) if np.any(acc > 0) else 1.0
    a = acc / scale
    n = len(a)
    emit = np.where(np.arange(meter)[None, :] == 0, a[:, None], -0.5 * a[:, None])
    if anchor is not None and 0 <= anchor < n:
        emit[anchor, 1:] = -1e6
    score = emit[0].copy()
    back = np.zeros((n, meter), dtype=int)
    for t in range(1, n):
        new = np.full(meter, -np.inf)
        for pos in range(meter):
            # regular: from pos-1; slip: from any other position
            regular = score[(pos - 1) % meter]
            slips = [score[q] - SLIP_COST for q in range(meter) if q != (pos - 1) % meter]
            best_slip = max(slips) if slips else -np.inf
            if regular >= best_slip:
                new[pos], back[t, pos] = regular, (pos - 1) % meter
            else:
                q = max((q for q in range(meter) if q != (pos - 1) % meter), key=lambda q: score[q])
                new[pos], back[t, pos] = best_slip, q
        score = new + emit[t]
    path = [int(np.argmax(score))]
    for t in range(n - 1, 0, -1):
        path.append(int(back[t, path[-1]]))
    path.reverse()
    # Quality of this meter: how much louder its downbeats are than its other beats,
    # less the slips it needed (a measure of the wrong length) per measure.
    pos = np.array(path)
    down, other = a[pos == 0], a[pos != 0]
    if len(down) == 0 or len(other) == 0:
        return -np.inf, path
    slips = sum(1 for prev, cur in zip(path, path[1:], strict=False) if cur != (prev + 1) % meter)
    contrast = float(down.mean() - other.mean())
    return contrast - SLIP_COST * slips / len(down), path


def choose_meter(
    beats: np.ndarray,
    notes: list[NoteEvent],
    meter: int | None = None,
    anchor: int | None = None,
) -> tuple[int, list[int]]:
    """Beats per measure (or the given `meter`), and the position of every beat in
    its measure (`anchor`: a beat that must be a downbeat)."""
    acc = beat_accents(beats, notes)
    best: tuple[float, int, list[int]] | None = None
    for candidate in (meter,) if meter else (4, 3, 2):
        value, path = _downbeat_path(acc, candidate, anchor)
        if candidate == 4:
            value += 0.02  # 4 over 2 when they explain the same downbeats
        if best is None or value > best[0]:
            best = (value, candidate, path)
    assert best is not None
    return best[1], best[2]


def regularize(beats: np.ndarray, positions: list[int], meter: int, acc: np.ndarray) -> np.ndarray:
    """Make every measure `meter` beats long: drop the weakest extra beat, add a missing
    one in the widest gap, keep every other beat where the beat was doubled."""
    downs = [i for i, p in enumerate(positions) if p == 0]
    if not downs:
        return beats
    out: list[float] = list(beats[: downs[0]])
    for k, d in enumerate(downs):
        nxt = downs[k + 1] if k + 1 < len(downs) else len(beats)
        seg = list(range(d, nxt))
        if k + 1 == len(downs):  # last measure: keep as it is
            out.extend(beats[i] for i in seg)
            break
        if len(seg) == 2 * meter:
            seg = seg[::2]
        while len(seg) > meter:
            weakest = min(seg[1:], key=lambda i: acc[i])
            seg.remove(weakest)
        times = [float(beats[i]) for i in seg]
        end = float(beats[nxt])
        while len(times) < meter:
            bounds = times + [end]
            widest = int(np.argmax(np.diff(bounds)))
            times.insert(widest + 1, (bounds[widest] + bounds[widest + 1]) / 2)
        out.extend(times)
    return np.array(out)


def quantize(notes: list[NoteEvent], beats: np.ndarray, first_downbeat: int) -> list[Placed]:
    on = to_beats(np.array([n.onset for n in notes]), beats) - first_downbeat
    off = to_beats(np.array([n.offset for n in notes]), beats) - first_downbeat
    # Grid per beat: whichever of sixteenths / triplets fits the onsets in it better.
    by_beat: dict[int, list[float]] = defaultdict(list)
    for x in on:
        by_beat[int(np.floor(x + 1e-6))].append(float(x))
    grid_of: dict[int, Fraction] = {}
    plain = Fraction(1, 4)
    for b, xs in by_beat.items():

        def cost(g: Fraction) -> float:
            gf = float(g)
            err = sum(abs(x - b - round((x - b) / gf) * gf) for x in xs) / len(xs)
            return err + GRIDS[g]

        grid_of[b] = min(GRIDS, key=cost)

    def snap(x: float) -> Fraction:
        b = int(np.floor(x + 1e-6))
        g = grid_of.get(b, plain)
        return b + Fraction(round((x - b) / float(g))) * g

    placed = []
    for n, a, z in zip(notes, on, off, strict=True):
        start = snap(float(a))
        end = max(snap(float(z)), start + grid_of.get(int(np.floor(a + 1e-6)), plain))
        placed.append(Placed(start, end, n.pitch, n.velocity))
    return placed


def split_hands(placed: list[Placed], meter: int) -> None:
    """Left hand below the split point; the split is the widest pitch gap between
    E3 and A4 in each measure (middle C when there is no clear gap)."""
    by_measure: dict[int, list[Placed]] = defaultdict(list)
    for p in placed:
        by_measure[int(p.onset // meter)].append(p)
    for notes in by_measure.values():
        pitches = sorted({p.pitch for p in notes})
        split = 60
        gaps = [
            (b - a, (a + b) / 2)
            for a, b in zip(pitches, pitches[1:], strict=False)
            if 52 <= (a + b) / 2 <= 69
        ]
        if gaps:
            width, middle = max(gaps)
            if width >= 3:
                split = middle
        for p in notes:
            p.hand = 1 if p.pitch >= split else 2


def to_score(
    notes: list[NoteEvent],
    pedals: list[PedalEvent] | None = None,
    title: str = "",
    hints: TranscribeHints | None = None,
    grid: np.ndarray | None = None,
) -> tuple[str, dict]:
    """MusicXML of the transcription, and facts about it (tempo, meter, key).
    `hints`: what the user knows (tempo, meter, key, pickup); the rest is inferred.
    `grid`: exact quarter-note beat times (s), the first on a bar line, when the
    notes come from a MIDI file written on a grid: no beat tracking then."""
    from music21 import (
        chord,
        clef,
        key,
        metadata,
        note,
        stream,
        tempo,
    )
    from music21 import (
        meter as m21meter,
    )
    from music21.musicxml.m21ToXml import GeneralObjectExporter

    if not notes:
        raise ValueError("nessuna nota trascritta")
    hints = hints or TranscribeHints()
    onsets = np.array([n.onset for n in notes])

    def anchor(beats: np.ndarray) -> int | None:
        """The first downbeat, when the user said how many beats come before it."""
        if hints.pickup_beats is None:
            return None
        return int(round(float(np.min(to_beats(onsets, beats))))) + hints.pickup_beats

    if grid is not None:
        beats = np.asarray(grid, dtype=float)
        meter_beats = hints.beats_per_measure or choose_meter(beats, notes)[0]
        positions = [i % meter_beats for i in range(len(beats))]
    else:
        beats = track_beats(notes, tempo=hints.tempo)
        if not hints.tempo:
            beats = half_time(beats, notes)
        meter_beats, positions = choose_meter(beats, notes, hints.beats_per_measure, anchor(beats))
        beats = regularize(beats, positions, meter_beats, beat_accents(beats, notes))
        # Re-find the downbeats on the regular grid (no slips left), same meter.
        if len(beats):
            positions = choose_meter(beats, notes, meter_beats, anchor(beats))[1]
    first = next((i for i, p in enumerate(positions) if p == 0), 0)
    on_beats = to_beats(np.array([n.onset for n in notes]), beats)
    first_downbeat = first if first <= float(np.min(on_beats)) + 0.5 else first - meter_beats
    if (known := anchor(beats)) is not None:
        first_downbeat = known
    placed = quantize(notes, beats, first_downbeat)
    pickup = Fraction(0)
    lowest = min(p.onset for p in placed)
    if lowest < 0:  # notes before the first downbeat: a pickup
        pickup = -Fraction(int(np.floor(float(lowest))))
        for p in placed:
            p.onset += pickup
            p.end += pickup
    # The last notes ring on (decay, pedal): end them with the last measure.
    last = max(p.onset for p in placed)
    final_bar_end = pickup + (int((last - pickup) // meter_beats) + 1) * meter_beats
    for p in placed:
        p.end = min(p.end, Fraction(final_bar_end))
    split_hands(placed, meter_beats)

    bpm = float(60 / np.median(np.diff(beats))) if len(beats) > 1 else 100.0
    score = stream.Score()
    score.metadata = metadata.Metadata(title=title or "Trascrizione")
    parts = {}
    for hand in (1, 2):
        part = stream.PartStaff()
        part.insert(0, clef.TrebleClef() if hand == 1 else clef.BassClef())
        part.insert(0, m21meter.TimeSignature(f"{meter_beats}/4"))
        if hand == 1:
            part.insert(0, tempo.MetronomeMark(number=round(bpm)))
        mine = sorted((p for p in placed if p.hand == hand), key=lambda p: (p.onset, p.pitch))
        groups: dict[Fraction, list[Placed]] = defaultdict(list)
        for p in mine:
            groups[p.onset].append(p)
        onsets = sorted(groups)
        for i, start in enumerate(onsets):
            g = groups[start]
            nxt = onsets[i + 1] if i + 1 < len(onsets) else None
            end = max(p.end for p in g)
            if nxt is not None:
                end = min(end, nxt)  # one line of chords per hand: a held note stops at the next
            length = end - start
            if length <= 0:
                continue
            el = note.Note(g[0].pitch) if len(g) == 1 else chord.Chord(sorted({p.pitch for p in g}))
            el.quarterLength = length
            el.volume.velocity = max(p.velocity for p in g)
            part.insert(float(start), el)
        parts[hand] = part
    for hand in (1, 2):
        score.insert(0, parts[hand])
    score.insert(0, _staff_group(parts))
    detected = _hinted_key(hints.key) if hints.key else _choose_key(score, placed, pickup)
    for part in parts.values():
        part.insert(0, key.KeySignature(detected.sharps))
    _spell(score, detected)
    score = score.makeNotation()
    xml = GeneralObjectExporter(score).parse().decode("utf-8")
    if pedals:
        origin = first_downbeat - float(pickup)
        xml = add_pedal_marks(xml, pedals, beats, origin, meter_beats, float(pickup))
    facts = {
        "tempo": round(bpm),
        "beatsPerMeasure": meter_beats,
        "key": f"{detected.tonic.name.replace('-', 'b')} {detected.mode}",
        "pickupBeats": float(pickup),
    }
    return xml, facts


KEY_MARGIN = 0.1  # correlation within which the opening bass decides between keys


def _choose_key(score, placed: list[Placed], pickup: Fraction):  # noqa: ANN001, ANN202
    """Key from the pitch profile (Krumhansl); among keys that fit almost as well,
    the one whose tonic is the bass of the first downbeat (I-V-vi-IV in Eb rings
    as much Ab as Eb, but it starts on Eb)."""
    best = score.analyze("key")
    opening = [p for p in placed if pickup <= p.onset < pickup + 1] or [
        p for p in placed if p.onset >= pickup
    ]
    if not opening:
        return best
    bass = min(p.pitch for p in opening) % 12
    for k in [best, *best.alternateInterpretations]:
        if k.correlationCoefficient < best.correlationCoefficient - KEY_MARGIN:
            break
        if k.tonic.pitchClass == bass:
            return k
    return best


def _hinted_key(name: str):  # noqa: ANN202
    """'Bb minor' -> music21 Key."""
    from music21 import key

    tonic, mode = name.split()
    return key.Key(tonic[0] + tonic[1:].replace("b", "-"), mode)


def _staff_group(parts):  # noqa: ANN001, ANN202
    from music21 import layout

    return layout.StaffGroup([parts[1], parts[2]], symbol="brace", barTogether=True)


def _spell(score, k) -> None:  # noqa: ANN001
    """Spell each pitch as the key would: flats in flat keys, scale notes as written."""
    scale = {p.name for p in k.getScale().getPitches()}
    for n in score.recurse().notes:
        for p in n.pitches:
            if p.accidental is not None and p.accidental.alter == 0:
                p.accidental = None  # from MIDI numbers: a natural sign on every white key
            if p.name in scale:
                continue
            alt = p.getEnharmonic()
            if alt is not None and (
                alt.name in scale or (k.sharps < 0 and "-" in alt.name and "#" in p.name)
            ):
                p.name, p.octave = alt.name, alt.octave


def add_pedal_marks(
    xml: str,
    pedals: list[PedalEvent],
    beats: np.ndarray,
    origin: float,
    meter: int,
    pickup: float,
) -> str:
    """Sustain pedal as MusicXML <pedal> directions (Ped. ... *) under the left hand.
    `origin` is the beat coordinate of the score's start; a pickup measure, if any,
    is `pickup` beats long."""
    import xml.etree.ElementTree as ET

    root = ET.fromstring(xml.encode("utf-8"))
    part = root.find("part")
    if part is None:
        return xml
    measures = part.findall("measure")
    divisions = 1
    for m in measures:
        d = m.find("attributes/divisions")
        if d is not None and d.text:
            divisions = int(d.text)
            break
    staves = root.find(".//attributes/staves")
    staff = staves.text if staves is not None and staves.text else None

    def place(t: float) -> tuple[int, float] | None:
        b = float(to_beats(np.array([t]), beats)[0]) - origin
        if b < -0.5:
            return None
        b = max(0.0, b)  # pressed just before the first note
        if pickup > 0:
            if b < pickup:
                return 0, b
            b -= pickup
            index = 1 + int(b // meter)
        else:
            index = int(b // meter)
        return index, b - (index - (1 if pickup > 0 else 0)) * meter

    marks: dict[int, list[tuple[float, str]]] = defaultdict(list)
    for ped in pedals:
        start, stop = place(ped.onset), place(ped.offset)
        if start is None or stop is None or start[0] >= len(measures):
            continue
        marks[start[0]].append((start[1], "start"))
        if stop[0] < len(measures):
            marks[stop[0]].append((stop[1], "stop"))
        else:
            last = len(measures) - 1
            length = meter if last or not pickup else pickup
            marks[last].append((float(length), "stop"))
    for index, items in marks.items():
        measure = measures[index]
        at = 0
        for k, child in enumerate(list(measure)):
            if child.tag not in ("attributes", "print", "direction"):
                at = k
                break
        else:
            at = len(measure)
        for offset, kind in sorted(items, reverse=True):
            d = ET.Element("direction", placement="below")
            pedal = ET.SubElement(ET.SubElement(d, "direction-type"), "pedal", type=kind, line="no")
            pedal.set("sign", "yes")
            if offset > 0:
                ET.SubElement(d, "offset", sound="yes").text = str(round(offset * divisions))
            if staff:
                ET.SubElement(d, "staff").text = staff
            ET.SubElement(d, "sound", **{"damper-pedal": "yes" if kind == "start" else "no"})
            measure.insert(at, d)
    head = xml[: xml.index("<score-partwise")]
    return head + ET.tostring(root, encoding="unicode")
