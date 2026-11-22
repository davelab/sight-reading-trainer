"""Hanon Part II and III: the exercises with a structure of their own."""

from __future__ import annotations

from hanon import Bar, Event, Exercise, P, Pitch, diatonic, sixteenths

LETTERS = "CDEFGAB"


def _tone(name: str, root: Pitch, octave: int) -> Pitch:
    """Chord tone `name` ('F#') in the octave of a root at `octave` (above it)."""
    letter, alter = name[0], (1 if "#" in name else -1 if "b" in name else 0)
    up = LETTERS.index(letter) < LETTERS.index(root.step)
    return Pitch(letter, alter, octave + (1 if up else 0))


def _chord(names: list[str], octave: int) -> list[Pitch]:
    root = P(names[0] + str(octave))
    return [_tone(n, root, octave) for n in names]


def _arpeggio_bars(names: list[str], rh_oct: int, label: str) -> list[Bar]:
    """No. 43, one key: A (4 times), then B-C-D repeated."""

    def tones(octave: int) -> list[Pitch]:
        return _chord(names, octave)

    def figure(octave: int) -> list[Pitch]:  # R 3 5 7 R' 7 5 3
        t, t2 = tones(octave), tones(octave + 1)
        return [t[0], t[1], t[2], t[3], t2[0], t[3], t[2], t[1]]

    def rise(octave: int) -> list[Pitch]:  # R 3 5 7 R' 3' 5' 7'
        return tones(octave) + tones(octave + 1)

    def fall(octave: int) -> list[Pitch]:  # R'' 7' 5' 3' R' 7 5 3
        hi, lo = tones(octave + 1), tones(octave)
        return [
            hi[0],
            lo[3],
            lo[2],
            lo[1],
            lo[0],
            tones(octave - 1)[3],
            tones(octave - 1)[2],
            tones(octave - 1)[1],
        ]

    lh = rh_oct - 1
    a = Bar(
        sixteenths(figure(rh_oct), [1, 2, 3, 4, 5]),
        sixteenths(figure(lh), [5, 4, 3, 2, 1]),
        repeat_start=True,
        repeat_end=True,
        text=f"{label} — 4 volte",
        times=4,
    )
    b = Bar(
        sixteenths(rise(rh_oct), [1, None, None, None, 1]),
        sixteenths(rise(lh), [5, None, None, None, None, 4]),
        repeat_start=True,
    )
    c = Bar(
        sixteenths(figure(rh_oct + 2), [1, None, None, None, 5]),
        sixteenths(figure(lh + 2), [4, None, None, None, 1]),
    )
    d = Bar(
        sixteenths(fall(rh_oct + 1), [None, 4, None, None, None, 4]),
        sixteenths(fall(lh + 1), [1, None, None, None, 1]),
        repeat_end=True,
    )
    return [a, b, c, d]


def no43() -> Exercise:
    keys = [
        (["C", "E", "G", "Bb"], 3, "Do7 (dominante di Fa)"),
        (["D", "F#", "A", "C"], 3, "Re7 (dominante di Sol)"),
        (["E", "G#", "B", "D"], 3, "Mi7 (dominante di La)"),
        (["F", "A", "C", "Eb"], 3, "Fa7 (dominante di Si♭)"),
        (["G", "B", "D", "F"], 3, "Sol7 (dominante di Do)"),
        (["A", "C#", "E", "G"], 3, "La7 (dominante di Re)"),
        (["B", "D#", "F#", "A"], 3, "Si7 (dominante di Mi)"),
    ]
    bars: list[Bar] = []
    for names, octave, label in keys:
        bars += _arpeggio_bars(names, octave, label)
    # Close in C: the major-seventh arpeggio up, down, the figure, low, chord.
    c4 = [P(n) for n in ("C4", "E4", "G4", "B4", "C5", "E5", "G5", "B5")]
    c3 = [P(n) for n in ("C3", "E3", "G3", "B3", "C4", "E4", "G4", "B4")]
    bars += [
        Bar(
            sixteenths(c4, [1, 2, 3, 4, 1]), sixteenths(c3, [5, 4, 3, 2, 1, 4]), text="Do maggiore"
        ),
        Bar(
            sixteenths([P("C6")] + c4[::-1][:7], [5, None, None, None, None, 4]),
            sixteenths([P("C5")] + c3[::-1][:7], [None, None, None, None, 1]),
        ),
        Bar(
            sixteenths(
                [P(n) for n in ("C4", "E4", "G4", "B4", "C5", "B4", "G4", "E4")],
                [1, None, None, None, 5],
            ),
            sixteenths([P(n) for n in ("C3", "E3", "G3", "B3", "C4", "B3", "G3", "E3")], [5]),
        ),
        Bar(
            sixteenths([P(n) for n in ("C4", "B3", "G3", "E3", "C3", "E3", "G3", "B3")], [4]),
            sixteenths([P(n) for n in ("C3", "B2", "G2", "E2", "C2", "E2", "G2", "B2")], [1]),
        ),
        Bar(
            [Event([P("E3"), P("G3"), P("C4")], 8, [1, 2, 5])],
            [Event([P("C2"), P("E2"), P("G2"), P("C3")], 8)],
            final=True,
        ),
    ]
    return Exercise(
        43,
        "Hanon n. 43",
        "Arpeggi sugli accordi di settima di dominante: estensione delle dita e forma della mano.",
        "♩ = 60–120",
        2,
        4,
        bars,
        "69–70",
    )


def _dyad(low: int, interval: int, fingers: list[int] | None = None) -> Event:
    """Two notes struck together: a white-key third (interval 2) or sixth (5)
    on diatonic index `low`; fingers low note first."""
    return Event([diatonic(low), diatonic(low + interval)], 1, fingers or [])


def _run(start: str, steps: list[int]) -> list[int]:
    """Diatonic indexes from `start` following the given moves (each +1 or -1)."""
    i = P(start).index
    out = [i]
    for s in steps:
        i += s
        out.append(i)
    return out


def _line(start: str, up: int, down: int = 0) -> list[int]:
    """`up` notes rising by step from `start`, then `down` notes falling."""
    return _run(start, [1] * (up - 1) + [-1] * down)


def _fall_rise(start: str, down: int, up: int) -> list[int]:
    return _run(start, [-1] * (down - 1) + [1] * up)


def _detached(interval: int, base: str, rh_f: list[int], lh_f: list[int], label: str) -> list[Bar]:
    """No. 48, thirds (interval 2) or sixths (5): the wrist exercise. Lower notes
    of the right hand from `base` (C4 for thirds, E4 for sixths); the left hand
    an octave lower, apart where the printed page has the hands move apart."""
    b = P(base).index
    n = lambda name: P(name).index - P("C4").index + b  # noqa: E731 - same shape from `base`

    def bar(rh: list[int], lh: list[int], **kw) -> Bar:
        return Bar(
            [_dyad(i, interval, rh_f if k == 0 else None) for k, i in enumerate(rh)],
            [_dyad(i, interval, lh_f if k == 0 else None) for k, i in enumerate(lh)],
            **kw,
        )

    def name(i: int) -> str:
        p = diatonic(i)
        return f"{p.step}{p.octave}"

    def same(rh: list[int]) -> list[int]:
        return [i - 7 for i in rh]

    rep = lambda a, c: [n(a)] * 8 + [n(c)] * 8  # noqa: E731
    bars = [
        bar(rep("C4", "D4"), same(rep("C4", "D4")), repeat_start=True, text=f"{label} — simile"),
        bar(rep("E4", "F4"), same(rep("E4", "F4"))),
        bar(rep("E4", "F4"), same(rep("E4", "F4"))),
        bar(rep("E4", "D4"), same(rep("E4", "D4")), repeat_end=True),
    ]
    up16 = _line(name(n("C4")), 16)  # two octaves up
    down16 = _fall_rise(name(n("E6")), 16, 0)
    bars += [
        bar(up16, same(up16), repeat_start=True),
        bar(down16, same(down16)),
        bar(up16, _line(name(n("C3")), 9, 7)),
        bar(_fall_rise(name(n("E6")), 9, 7), _line(name(n("C3")), 16)),
        bar(_fall_rise(name(n("E6")), 9, 7), _fall_rise(name(n("E5")), 16, 0)),
        bar(down16, _line(name(n("C3")), 9, 7)),
        bar(_line(name(n("C4")), 9, 7), _fall_rise(name(n("C3")), 9, 7)),
        bar(_fall_rise(name(n("C4")), 9, 7), _fall_rise(name(n("C3")), 9, 7), repeat_end=True),
    ]
    return bars


def no48() -> Exercise:
    bars = _detached(2, "C4", [2, 4], [4, 2], "Terze staccate")
    bars += _detached(5, "E4", [1, 5], [5, 1], "Seste staccate")
    bars.append(Bar([Event([P("E4"), P("C5")], 16)], [Event([P("E3"), P("C4")], 16)], final=True))
    return Exercise(
        48,
        "Hanon n. 48",
        "Esercizio di polso: terze e seste staccate, il braccio fermo e il polso morbido.",
        "𝅗𝅥 = 40–84",
        4,
        4,
        bars,
        "78–79",
        bpm=80,
    )


def no50() -> Exercise:
    """Legato thirds: groups of four (k, k+1, k+2, k+1), right hand an octave
    above the left; up from C3 for 22 groups, turn, and down to E3."""
    rh_up = (1, 3)  # fingers, low note first (the page prints 3 over 1)
    rh_down = (3, 5)
    lh_up = (5, 3)
    lh_down = (3, 1)
    c3 = P("C3").index

    def group(k: int, up: bool) -> list[int]:
        return [k, k + 1, k + 2, k + 1] if up else [k + 2, k + 1, k, k + 1]

    def bar_of(groups: list[tuple[int, bool]], **kw) -> Bar:
        rh, lh = [], []
        for k, up in groups:
            for j, i in enumerate(group(k, up)):
                rf = list(rh_up if up else rh_down) if j == 0 else None
                lf = list(lh_up if up else lh_down) if j == 0 else None
                rh.append(_dyad(i, 2, rf))
                lh.append(_dyad(i - 7, 2, lf))
        return Bar(rh, lh, **kw)

    first = Bar(
        [
            _dyad(i, 2, f)
            for i, f in zip(
                [c3, c3 + 1, c3 + 2, c3 + 1] * 4,
                [[1, 3], [2, 4], [3, 5], [2, 4], [1, 3]] + [None] * 11,
                strict=True,
            )
        ],
        [
            _dyad(i - 7, 2, f)
            for i, f in zip(
                [c3, c3 + 1, c3 + 2, c3 + 1] * 4,
                [[5, 3], [4, 2], [3, 1], [4, 2], [5, 3]] + [None] * 11,
                strict=True,
            )
        ],
    )
    bars = []
    for n in range(4):
        b = (
            Bar(list(first.rh), list(first.lh))
            if n == 0
            else Bar(
                [Event(e.pitches, 1) for e in first.rh], [Event(e.pitches, 1) for e in first.lh]
            )
        )
        bars.append(b)
    bars[0].repeat_start = True
    bars[0].text = "Terze legate"
    bars[-1].repeat_end = True
    ups = [(c3 + k, True) for k in range(22)]  # C3 ... C6
    downs = [(c3 + 21 - k, False) for k in range(22)]  # tops E6 ... E3 (top = k + 2)
    groups = ups + downs
    body = [bar_of(groups[i : i + 4]) for i in range(0, len(groups), 4)]
    body[0].repeat_start = True
    body[-1].repeat_end = True
    bars += body
    bars.append(Bar([Event([P("C3"), P("E3")], 16)], [Event([P("C2"), P("E2")], 16)], final=True))
    return Exercise(
        50,
        "Hanon n. 50",
        "Terze legate: ogni nota uguale e ben distinta; le terze sono essenziali "
        "nella musica difficile.",
        "𝅗𝅥 = 40–84",
        4,
        4,
        bars,
        "81–82",
        bpm=80,
    )


def advanced() -> list[Exercise]:
    return [no43(), no48(), no50()]
