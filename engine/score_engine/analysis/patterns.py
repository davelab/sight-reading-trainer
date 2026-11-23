"""Repeated phrases: exact and transposed, per hand and for both hands.

1. Fingerprint of every measure (written order) for a scope — both hands /
   all staves, or one staff of a piano grand staff: the note onsets as
   (position in the measure, duration, pitches).
   - exact key: absolute pitches + rhythm;
   - transposed key: diatonic steps from the measure's first (lowest) note +
     rhythm, so tonal sequences match even when a third changes quality.
2. Self-similarity: for every pair of measures (i, j) that match, follow the
   diagonal while the next measures match too (with the same transposition),
   never letting the two occurrences overlap. Each maximal run is a repeated
   phrase; this generalises the spec's 2/4/8-measure windows and keeps the
   longest repetition (a 6-measure phrase is one pattern, not three windows).
3. Runs with the same content are merged into one pattern with all its
   occurrences. Kept only if it lasts MIN_MEASURES and has MIN_NOTES per
   occurrence (two long notes repeating are not a phrase), and is not inside
   a longer pattern already reported.

Measures that are empty or only rests never match. Written repeats (:||) are
not expanded: a section played twice is written once, so it is not a
"repeated phrase" to study twice. Near-identical variants are a later phase.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from fractions import Fraction

from music21 import interval as m21interval
from music21 import pitch as m21pitch
from music21 import stream

MIN_MEASURES = 2
MIN_NOTES = 4

Scope = str  # "both" | "right" | "left"


@dataclass(frozen=True)
class MeasurePrint:
    exact: tuple | None
    transposed: tuple | None
    anchor: m21pitch.Pitch | None  # lowest note of the first onset
    notes: int


@dataclass
class Found:
    scope: Scope
    kind: str  # "exact" | "transposed"
    length: int
    starts: list[int]  # 0-based measure indices
    anchors: list[m21pitch.Pitch | None] = field(default_factory=list)


def _q(x: float) -> Fraction:
    return Fraction(x).limit_denominator(64)


def fingerprint(onsets: list[tuple[float, float, list[m21pitch.Pitch]]]) -> MeasurePrint:
    """`onsets`: (offset in the measure, quarter length, pitches) of every note/chord."""
    events = sorted(
        ((_q(off), _q(dur), sorted(ps, key=lambda p: p.ps)) for off, dur, ps in onsets if ps),
        key=lambda e: (e[0], e[2][0].ps, e[1]),
    )
    if not events:
        return MeasurePrint(None, None, None, 0)
    anchor = events[0][2][0]
    exact = tuple((o, d, tuple(round(p.ps) for p in ps)) for o, d, ps in events)
    steps = tuple(
        (o, d, tuple(p.diatonicNoteNum - anchor.diatonicNoteNum for p in ps)) for o, d, ps in events
    )
    return MeasurePrint(exact, steps, anchor, sum(len(ps) for _, _, ps in events))


def _onsets(measure: stream.Measure) -> list[tuple[float, float, list[m21pitch.Pitch]]]:
    out = []
    for n in measure.recurse().notes:
        if n.tie is not None and n.tie.type in ("stop", "continue"):
            continue  # a held note is not a new onset
        out.append(
            (float(n.getOffsetInHierarchy(measure)), float(n.quarterLength), list(n.pitches))
        )
    return out


def scopes(score: stream.Score) -> dict[Scope, list[MeasurePrint]]:
    """Fingerprints per scope. Hands only for a two-staff piano part."""
    parts = list(score.parts)
    measures = [list(p.getElementsByClass(stream.Measure)) for p in parts]
    n = min((len(m) for m in measures), default=0)
    out: dict[Scope, list[MeasurePrint]] = {
        "both": [fingerprint([o for ms in measures for o in _onsets(ms[i])]) for i in range(n)]
    }
    if len(parts) == 2 and all(isinstance(p, stream.PartStaff) for p in parts):
        out["right"] = [fingerprint(_onsets(measures[0][i])) for i in range(n)]
        out["left"] = [fingerprint(_onsets(measures[1][i])) for i in range(n)]
    return out


def _shift(prints: list[MeasurePrint], i: int, j: int) -> int:
    a, b = prints[i].anchor, prints[j].anchor
    return b.diatonicNoteNum - a.diatonicNoteNum if a and b else 0


def _match(prints: list[MeasurePrint], i: int, j: int, kind: str) -> bool:
    a, b = prints[i], prints[j]
    if kind == "exact":
        return a.exact is not None and a.exact == b.exact
    return a.transposed is not None and a.transposed == b.transposed


def find_runs(prints: list[MeasurePrint], kind: str) -> list[tuple[int, int, int]]:
    """Maximal non-overlapping runs (i, j, length) where measures i.. repeat at j..

    For "transposed" the shift must be non-zero and the same along the run.
    """
    n = len(prints)
    runs = []
    for i in range(n):
        for j in range(i + 1, n):
            if not _match(prints, i, j, kind):
                continue
            shift = _shift(prints, i, j)
            if kind == "transposed" and shift == 0:
                continue
            if (
                i > 0
                and _match(prints, i - 1, j - 1, kind)
                and _shift(prints, i - 1, j - 1) == shift
            ):
                if kind == "exact" or shift != 0:
                    continue  # not the start of the run
            k = 1
            while (
                j + k < n
                and i + k < j
                and _match(prints, i + k, j + k, kind)
                and _shift(prints, i + k, j + k) == shift
            ):
                k += 1
            runs.append((i, j, k))
    return runs


def _signature(prints: list[MeasurePrint], start: int, k: int, kind: str) -> tuple:
    seg = prints[start : start + k]
    if kind == "exact":
        return tuple(p.exact for p in seg)
    base = seg[0].anchor.diatonicNoteNum if seg[0].anchor else 0
    return tuple(
        (p.transposed, (p.anchor.diatonicNoteNum - base) if p.anchor else None) for p in seg
    )


def group_runs(
    prints: list[MeasurePrint], runs: list[tuple[int, int, int]], kind: str, scope: Scope
) -> list[Found]:
    groups: dict[tuple, set[int]] = {}
    for i, j, k in runs:
        key = (k, _signature(prints, i, k, kind))
        groups.setdefault(key, set()).update((i, j))
    found = []
    for (k, _), starts in groups.items():
        kept: list[int] = []
        for s in sorted(starts):
            if not kept or s >= kept[-1] + k:
                kept.append(s)
        if len(kept) < 2 or k < MIN_MEASURES:
            continue
        if sum(p.notes for p in prints[kept[0] : kept[0] + k]) < MIN_NOTES:
            continue
        found.append(Found(scope, kind, k, kept, [prints[s].anchor for s in kept]))
    return found


def _covers(outer: Found, inner: Found) -> bool:
    if outer.scope not in ("both", inner.scope):
        return False
    return all(
        any(t <= s and s + inner.length <= t + outer.length for t in outer.starts)
        for s in inner.starts
    )


def find_patterns(score: stream.Score) -> list[Found]:
    candidates: list[Found] = []
    for scope, prints in scopes(score).items():
        for kind in ("exact", "transposed"):
            candidates += group_runs(prints, find_runs(prints, kind), kind, scope)
    # Longest first; with equal length more occurrences first; "both" before one hand.
    candidates.sort(key=lambda f: (-f.length, -len(f.starts), f.scope != "both", f.kind != "exact"))
    accepted: list[Found] = []
    for f in candidates:
        if not any(_covers(a, f) for a in accepted):
            accepted.append(f)
    accepted.sort(key=lambda f: (f.starts[0], -f.length))
    return accepted


def interval_name(a: m21pitch.Pitch | None, b: m21pitch.Pitch | None) -> str:
    """'P1', '+M2', '-P5': from the first occurrence to another one."""
    if a is None or b is None:
        return "P1"
    iv = m21interval.Interval(noteStart=a, noteEnd=b)
    if iv.semitones == 0 and iv.generic.directed == 1:
        return "P1"
    sign = "-" if iv.direction == m21interval.Direction.DESCENDING else "+"
    return f"{sign}{iv.name}"
