"""Global key and modulations (Krumhansl-Schmuckler).

1. Global key: music21's Krumhansl-Schmuckler on the whole score, with its
   correlation coefficient as confidence.
2. Modulations: the same profiles on sliding windows of WINDOW measures; a new
   region opens only when the new key wins CONFIRM consecutive windows, which
   avoids jumping on a single secondary dominant.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from music21 import key as m21key
from music21 import stream
from music21.analysis.discrete import KrumhanslSchmuckler

from .common import MeasureSlices, pitch_class_weights

WINDOW = 4
CONFIRM = 2
MIN_REGION = 2  # measures

_KS = KrumhanslSchmuckler()
PROFILES = {"major": _KS.getWeights("major"), "minor": _KS.getWeights("minor")}


@dataclass(frozen=True)
class KeyGuess:
    tonic_pc: int
    mode: str  # "major" | "minor"
    confidence: float

    def same_key(self, other: KeyGuess) -> bool:
        return self.tonic_pc == other.tonic_pc and self.mode == other.mode


@dataclass
class Region:
    from_measure: int
    to_measure: int
    key: m21key.Key
    confidence: float


def _pearson(x: list[float], y: list[float]) -> float:
    mx, my = sum(x) / len(x), sum(y) / len(y)
    sx = math.sqrt(sum((a - mx) ** 2 for a in x))
    sy = math.sqrt(sum((b - my) ** 2 for b in y))
    if sx == 0 or sy == 0:
        return 0.0
    return sum((a - mx) * (b - my) for a, b in zip(x, y, strict=True)) / (sx * sy)


def best_key(weights: list[float]) -> KeyGuess | None:
    """Krumhansl-Schmuckler: correlate the pitch-class durations with the 24 rotated profiles."""
    if sum(weights) == 0:
        return None
    best: KeyGuess | None = None
    for mode, profile in PROFILES.items():
        for tonic in range(12):
            rotated = [profile[(pc - tonic) % 12] for pc in range(12)]
            r = _pearson(weights, rotated)
            if best is None or r > best.confidence:
                best = KeyGuess(tonic, mode, r)
    return best


def spelled_key(tonic_pc: int, mode: str, prefer_sharps: int = 0) -> m21key.Key:
    """Spell a key with the fewest accidentals in its signature (ties: the score's own side)."""
    names = ["C", "C#", "D", "E-", "E", "F", "F#", "G", "A-", "A", "B-", "B"]
    alternatives = {1: "D-", 6: "G-", 8: "G#", 3: "D#", 10: "A#", 11: "C-"}
    candidates = [names[tonic_pc]] + ([alternatives[tonic_pc]] if tonic_pc in alternatives else [])
    keys = [m21key.Key(n if mode == "major" else n.lower()) for n in candidates]
    return min(keys, key=lambda k: (abs(k.sharps) > 6, abs(k.sharps), -k.sharps * prefer_sharps))


def global_key(score: stream.Score) -> tuple[m21key.Key, float]:
    k = score.analyze("KrumhanslSchmuckler")
    return k, max(0.0, min(1.0, float(k.correlationCoefficient)))


def key_regions(measures: list[MeasureSlices], score: stream.Score) -> list[Region]:
    glob, glob_conf = global_key(score)
    n = len(measures)
    if n == 0:
        return []
    side = 1 if glob.sharps >= 0 else -1
    global_guess = KeyGuess(glob.tonic.pitchClass, glob.mode, glob_conf)

    width = min(WINDOW, n)
    windows: list[KeyGuess | None] = []
    for i in range(n - width + 1):
        weights = [0.0] * 12
        for m in measures[i : i + width]:
            for pc, w in enumerate(pitch_class_weights(m.slices, 0.0, m.duration)):
                weights[pc] += w
        windows.append(best_key(weights))

    # Walk the windows; a change needs CONFIRM consecutive agreeing windows.
    bounds: list[tuple[int, KeyGuess, list[float]]] = [(1, global_guess, [])]
    current = global_guess
    i = 0
    while i < len(windows):
        w = windows[i]
        if w is None or w.same_key(current):
            if w is not None:
                bounds[-1][2].append(w.confidence)
            i += 1
            continue
        run = windows[i : i + CONFIRM]
        if len(run) == CONFIRM and all(r is not None and r.same_key(w) for r in run):
            start = i + width // 2 + 1  # middle of the first winning window (1-based ordinal)
            bounds.append((start, w, [r.confidence for r in run if r]))
            current = w
            i += CONFIRM
        else:
            i += 1

    regions: list[Region] = []
    for idx, (start, guess, confs) in enumerate(bounds):
        end = bounds[idx + 1][0] - 1 if idx + 1 < len(bounds) else n
        if end < start:
            continue
        conf = sum(confs) / len(confs) if confs else guess.confidence
        k = glob if guess.same_key(global_guess) else spelled_key(guess.tonic_pc, guess.mode, side)
        regions.append(Region(start, end, k, max(0.0, min(1.0, conf))))

    # Absorb regions that are too short, then merge neighbours in the same key.
    merged: list[Region] = []
    for r in regions:
        if merged and (r.to_measure - r.from_measure + 1 < MIN_REGION or r.key == merged[-1].key):
            merged[-1].to_measure = r.to_measure
        else:
            merged.append(r)
    if len(merged) > 1 and merged[0].to_measure - merged[0].from_measure + 1 < MIN_REGION:
        merged[1].from_measure = merged[0].from_measure
        merged.pop(0)
    return merged


def key_at(regions: list[Region], ordinal: int) -> m21key.Key | None:
    for r in regions:
        if r.from_measure <= ordinal <= r.to_measure:
            return r.key
    return regions[-1].key if regions else None


def tonic_name(k: m21key.Key) -> str:
    """'G', 'F#', 'Bb' (music21 spells flats with '-')."""
    return k.tonic.name.replace("-", "b")
