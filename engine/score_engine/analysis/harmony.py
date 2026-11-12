"""Chords, symbols, roman numerals and harmonic function, one label per beat.

For each beat of the chordified score:

1. weigh every pitch class by how long it sounds in the beat, so short
   passing notes count little;
2. match the weights against chord templates (triads and sevenths on all 12
   roots), penalising unexplained notes and missing chord tones;
3. spell the winning chord from the notes actually written, then name it:
   symbol ("D7/F#"), roman numeral in the local key via music21
   (`romanNumeralFromChord`), with secondary dominants ("V7/IV") recognised
   explicitly, and function from the degree (I/vi tonic, ii/IV predominant,
   V/vii° dominant).

A beat whose chord equals the previous one in the same measure is not repeated.
"""

from __future__ import annotations

from dataclasses import dataclass

from music21 import chord as m21chord
from music21 import key as m21key
from music21 import pitch as m21pitch
from music21 import roman

from .common import MeasureSlices, Slice, pitch_class_weights
from .key import Region, key_at

Function = str  # "tonic" | "predominant" | "dominant" | "other"


@dataclass(frozen=True)
class Template:
    quality: str
    suffix: str  # chord-symbol suffix
    intervals: tuple[str, ...]  # above the root, music21 interval names
    semitones: tuple[int, ...]
    bias: float  # prior: prefer plain triads


TEMPLATES = [
    Template("major", "", ("M3", "P5"), (0, 4, 7), 0.0),
    Template("minor", "m", ("m3", "P5"), (0, 3, 7), 0.0),
    Template("diminished", "dim", ("m3", "d5"), (0, 3, 6), -0.1),
    Template("augmented", "aug", ("M3", "A5"), (0, 4, 8), -0.4),
    Template("dominant-seventh", "7", ("M3", "P5", "m7"), (0, 4, 7, 10), -0.15),
    Template("minor-seventh", "m7", ("m3", "P5", "m7"), (0, 3, 7, 10), -0.2),
    Template("half-diminished-seventh", "m7b5", ("m3", "d5", "m7"), (0, 3, 6, 10), -0.2),
    Template("diminished-seventh", "dim7", ("m3", "d5", "d7"), (0, 3, 6, 9), -0.2),
    Template("major-seventh", "maj7", ("M3", "P5", "M7"), (0, 4, 7, 11), -0.3),
]

# Penalty (in beats) for each chord tone that is missing: root, third, fifth, seventh.
MISSING_PENALTY = (1.0, 0.6, 0.15, 0.6)
BASS_IS_ROOT_BONUS = 0.3
# A seventh chord needs its seventh to sound for more than half the beat:
# a passing eighth over a triad is not a seventh chord.
SEVENTH_MIN_WEIGHT = 0.5
# Chord tones that must actually sound: two notes cannot make a seventh chord.
MIN_PRESENT = {3: 2, 4: 3}
DIATONIC_BONUS = 0.2


@dataclass
class ChordLabel:
    measure: int
    beat: float
    offset: float  # quarters from the measure start
    root_pc: int
    quality: str
    bass_pc: int
    symbol: str
    roman: str
    function: Function
    confidence: float


def _scale_pcs(k: m21key.Key) -> set[int]:
    pcs = {p.pitchClass for p in k.getScale().getPitches()}
    if k.mode == "minor":  # melodic/harmonic minor: raised 6th and 7th are diatonic too
        tonic = k.tonic.pitchClass
        pcs |= {(tonic + 9) % 12, (tonic + 11) % 12}
    return pcs


def _sounding_at(slices: list[Slice], t: float) -> list[m21pitch.Pitch]:
    for s in slices:
        if s.offset <= t < s.offset + s.duration:
            return s.pitches
    return []


def _spellings(slices: list[Slice], start: float, end: float) -> dict[int, m21pitch.Pitch]:
    """Most used written spelling of each pitch class in the window."""
    usage: dict[str, tuple[float, m21pitch.Pitch]] = {}
    for s in slices:
        overlap = min(end, s.offset + s.duration) - max(start, s.offset)
        if overlap > 0:
            for p in s.pitches:
                w, _ = usage.get(p.name, (0.0, p))
                usage[p.name] = (w + overlap, p)
    best: dict[int, tuple[float, m21pitch.Pitch]] = {}
    for w, p in usage.values():
        if p.pitchClass not in best or w > best[p.pitchClass][0]:
            best[p.pitchClass] = (w, p)
    return {pc: p for pc, (_, p) in best.items()}


def best_template(weights: list[float], beat: float, bass_pc: int | None, scale: set[int]):
    """Return (score, root_pc, template) of the best matching chord, or None for silence."""
    norm = [w / beat for w in weights]
    total = sum(norm)
    if total == 0:
        return None
    best = None
    for root in range(12):
        for t in TEMPLATES:
            pcs = [(root + s) % 12 for s in t.semitones]
            if len(pcs) == 4 and norm[pcs[3]] <= SEVENTH_MIN_WEIGHT:
                continue
            if sum(norm[pc] > 0 for pc in pcs) < MIN_PRESENT[len(pcs)]:
                continue
            present = sum(norm[pc] for pc in pcs)
            missing = sum(MISSING_PENALTY[i] for i, pc in enumerate(pcs) if norm[pc] == 0)
            score = present - (total - present) - missing + t.bias
            if bass_pc == root:
                score += BASS_IS_ROOT_BONUS
            if all(pc in scale for pc in pcs):
                score += DIATONIC_BONUS
            if best is None or score > best[0]:
                best = (score, root, t)
    return best


def _secondary_dominant(
    chord_pcs: set[int], inversion: int, seventh: bool, k: m21key.Key
) -> str | None:
    targets = (
        ["ii", "iii", "IV", "V", "vi"] if k.mode == "major" else ["iv", "V", "VI", "III", "VII"]
    )
    for t in targets:
        figure = f"V{'7' if seventh else ''}/{t}"
        rn = roman.RomanNumeral(figure, k)
        if {p.pitchClass for p in rn.pitches} == chord_pcs:
            inv = (["7", "65", "43", "42"] if seventh else ["", "6", "64"])[inversion]
            return f"V{inv}/{t}"
    return None


def _function(rn: roman.RomanNumeral, diatonic: bool) -> Function:
    if not diatonic:
        return "other"
    degree = rn.scaleDegree
    if degree in (1, 6):
        return "tonic"
    if degree in (2, 4):
        return "predominant"
    if degree in (5, 7):
        return "dominant"
    return "other"


def _name(p: m21pitch.Pitch) -> str:
    return p.name.replace("-", "b")


def label_measure(m: MeasureSlices, k: m21key.Key) -> list[ChordLabel]:
    labels: list[ChordLabel] = []
    scale = _scale_pcs(k)
    beat = m.beat_duration
    # Beat grid aligned to the meter (a pickup starts mid-measure).
    first = -(m.padding_left % beat) if m.padding_left else 0.0
    t = first
    while t < m.duration - 1e-9:
        start, end = max(t, 0.0), min(t + beat, m.duration)
        t += beat
        if end - start <= 1e-9:
            continue
        weights = pitch_class_weights(m.slices, start, end)
        sounding = _sounding_at(m.slices, start)
        bass = min(sounding, key=lambda p: p.ps) if sounding else None
        found = best_template(weights, end - start, bass.pitchClass if bass else None, scale)
        if found is None:
            continue
        score, root_pc, tmpl = found
        spelled = _spellings(m.slices, start, end)
        root = spelled.get(root_pc) or next(
            (p for p in k.getScale().getPitches() if p.pitchClass == root_pc),
            m21pitch.Pitch(root_pc),
        )
        root = m21pitch.Pitch(root.name)
        tones = [root] + [root.transpose(iv) for iv in tmpl.intervals]
        chord_pcs = {p.pitchClass for p in tones}
        # Bass for the inversion: lowest written chord tone at the beat start.
        chord_bass = next(
            (p for p in sorted(sounding, key=lambda p: p.ps) if p.pitchClass in chord_pcs), None
        )
        bass_tone = next(
            (p for p in tones if chord_bass and p.pitchClass == chord_bass.pitchClass), root
        )
        inversion = [p.pitchClass for p in tones].index(bass_tone.pitchClass)

        voiced = [m21pitch.Pitch(bass_tone.name + "3")] + [
            m21pitch.Pitch(p.name + "4") for p in tones if p.pitchClass != bass_tone.pitchClass
        ]
        diatonic = chord_pcs <= scale
        rn = roman.romanNumeralFromChord(m21chord.Chord(voiced), k)
        figure = rn.figure
        function = _function(rn, diatonic)
        if not diatonic and tmpl.quality in ("major", "dominant-seventh"):
            secondary = _secondary_dominant(chord_pcs, inversion, tmpl.quality != "major", k)
            if secondary:
                figure, function = secondary, "dominant"

        symbol = _name(root) + tmpl.suffix + (f"/{_name(bass_tone)}" if inversion else "")
        total = sum(weights) / (end - start)
        confidence = max(0.0, min(1.0, (score + 1.0) / (total + 1.0))) if total else 0.0
        label = ChordLabel(
            measure=m.ordinal,
            beat=round((start + m.padding_left) / beat + 1, 4),
            offset=round(start, 4),
            root_pc=root_pc,
            quality=tmpl.quality,
            bass_pc=bass_tone.pitchClass,
            symbol=symbol,
            roman=figure,
            function=function,
            confidence=round(confidence, 3),
        )
        prev = labels[-1] if labels else None
        if prev and (prev.root_pc, prev.quality, prev.bass_pc) == (
            root_pc,
            tmpl.quality,
            label.bass_pc,
        ):
            continue
        labels.append(label)
    return labels


def label_chords(measures: list[MeasureSlices], regions: list[Region]) -> list[ChordLabel]:
    labels: list[ChordLabel] = []
    for m in measures:
        k = key_at(regions, m.ordinal)
        if k is not None:
            labels.extend(label_measure(m, k))
    return labels
