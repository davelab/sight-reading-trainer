"""Hanon Part II and III: the exercises with a structure of their own."""

from __future__ import annotations

from hanon import Bar, Event, Exercise, P, Pitch, diatonic

LETTERS = "CDEFGAB"


def _tone(name: str, root: Pitch, octave: int) -> Pitch:
    """Chord tone `name` ('F#') in the octave of a root at `octave` (above it)."""
    letter, alter = name[0], (1 if "#" in name else -1 if "b" in name else 0)
    up = LETTERS.index(letter) < LETTERS.index(root.step)
    return Pitch(letter, alter, octave + (1 if up else 0))


def _chord(names: list[str], octave: int) -> list[Pitch]:
    root = P(names[0] + str(octave))
    return [_tone(n, root, octave) for n in names]


# No. 43 as printed: per key, the bars A (4 times), B, C, D; per bar the staff
# of each sixteenth (right hand, left hand) and its fingering ("." none).
A_F = ("12345...", "54321...")
B_F = ("1...1...", "5....4..")
C_F = ("1...5...", "4...1...")
D_F = (".4...4..", "1...1...")
S1, S2 = "1" * 8, "2" * 8
NO43 = {
    "C": [(S2, S2, A_F), ("22222111", S2, B_F), (S1, S1, C_F), ("11111222", S2, D_F)],
    "D": [(S2, S2, A_F), ("22221111", S2, B_F), (S1, S1, C_F), ("11111222", "12222222", D_F)],
    "E": [(S2, S2, A_F), ("22211111", S2, B_F), (S1, S1, C_F), ("11111122", "11222222", D_F)],
    "F": [
        (S2, S2, A_F),
        ("22211111", "22222221", B_F),
        (S1, S1, C_F),
        ("11111112", "11122222", D_F),
    ],
    "G": [
        ("22111112", S2, A_F),
        ("22111111", "22222211", B_F),
        (S1, S1, ("1...5...", "4.......")),
        (S1, "11122222", ("14...4..", "1...1...")),
    ],
    "A": [(S1, S2, A_F), (S1, S2, B_F), (S1, S2, ("1...5...", "4.......")), (S1, S2, D_F)],
    "B": [(S1, S2, A_F), (S1, S2, B_F), (S1, S2, ("1...5...", "4.......")), (S1, S2, D_F)],
}


def _laid_out(pitches: list[Pitch], staffs: str, fingers: str, ottava: bool = False) -> list[Event]:
    return [
        Event([p], 1, [int(f)] if f != "." else [], int(st), ottava)
        for p, st, f in zip(pitches, staffs, fingers, strict=True)
    ]


def _arpeggio_bars(names: list[str], rh_oct: int, words: str) -> list[Bar]:
    """No. 43, one key: A (4 times), then B-C-D repeated, as printed."""

    def tones(octave: int) -> list[Pitch]:
        return _chord(names, octave)

    def figure(octave: int) -> list[Pitch]:  # R 3 5 7 R' 7 5 3
        t, t2 = tones(octave), tones(octave + 1)
        return [t[0], t[1], t[2], t[3], t2[0], t[3], t[2], t[1]]

    def rise(octave: int) -> list[Pitch]:  # R 3 5 7 R' 3' 5' 7'
        return tones(octave) + tones(octave + 1)

    def fall(octave: int) -> list[Pitch]:  # R'' 7' 5' 3' R' 7 5 3
        hi, lo, below = tones(octave + 1), tones(octave), tones(octave - 1)
        return [hi[0], lo[3], lo[2], lo[1], lo[0], below[3], below[2], below[1]]

    lh = rh_oct - 1
    layout = NO43[names[0]]
    high = names[0] in "AB"  # La7 and Si7: the top bar 8va, the left hand in treble
    notes = [
        (figure(rh_oct), figure(lh)),
        (rise(rh_oct), rise(lh)),
        (figure(rh_oct + 2), figure(lh + 2)),
        (fall(rh_oct + 1), fall(lh + 1)),
    ]
    bars = []
    for k, ((rh, lhn), (rs, ls, (rf, lf))) in enumerate(zip(notes, layout, strict=True)):
        bars.append(Bar(_laid_out(rh, rs, rf, ottava=high and k == 2), _laid_out(lhn, ls, lf)))
    a, b, c, d = bars
    a.repeat_start = a.repeat_end = True
    a.times = 4
    a.words.append((1, 0, words, "above"))
    b.repeat_start = True
    d.repeat_end = True
    if high:
        b.clefs.append((2, 6, "G"))  # the left hand climbs into treble, on its staff
        d.clefs.append((2, 4, "F"))
    return bars


def no43() -> Exercise:
    keys = [
        (["C", "E", "G", "Bb"], "Repeat this measure 4 times."),
        (["D", "F#", "A", "C"], "4 times."),
        (["E", "G#", "B", "D"], "4 times."),
        (["F", "A", "C", "Eb"], "4 times."),
        (["G", "B", "D", "F"], "4 times."),
        (["A", "C#", "E", "G"], "4 times."),
        (["B", "D#", "F#", "A"], "4 times."),
    ]
    bars: list[Bar] = []
    for names, words in keys:
        bars += _arpeggio_bars(names, 3, words)
    # Close in C: the major-seventh arpeggio up, down, the figure, low, chord.
    up4 = [P(n) for n in ("C4", "E4", "G4", "B4", "C5", "E5", "G5", "B5")]
    up3 = [P(n) for n in ("C3", "E3", "G3", "B3", "C4", "E4", "G4", "B4")]
    fig4 = [P(n) for n in ("C4", "E4", "G4", "B4", "C5", "B4", "G4", "E4")]
    fig3 = [P(n) for n in ("C3", "E3", "G3", "B3", "C4", "B3", "G3", "E3")]
    low4 = [P(n) for n in ("C4", "B3", "G3", "E3", "C3", "E3", "G3", "B3")]
    low3 = [P(n) for n in ("C3", "B2", "G2", "E2", "C2", "E2", "G2", "B2")]
    bars += [
        Bar(_laid_out(up4, S1, "12341..."), _laid_out(up3, "22221111", "543214..")),
        Bar(
            _laid_out([P("C6")] + up4[::-1][:7], S1, "5....4.."),
            _laid_out([P("C5")] + up3[::-1][:7], "11112222", "....1..."),
        ),
        Bar(_laid_out(fig4, S1, "1...5..."), _laid_out(fig3, S2, "5.......")),
        Bar(_laid_out(low4, S2, ".4......"), _laid_out(low3, S2, "1.......")),
        Bar(
            [Event([P("E3"), P("G3"), P("C4")], 8, [1, 2, 5], 2)],
            [Event([P("C2"), P("E2"), P("G2"), P("C3")], 8, [], 2)],
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
        tempo_words="M.M. ♩ = 60 to 120.",
        heading="Extension of the fingers in chords of the dominant seventh, in arpeggios.",
        notes=(
            "End of Part II. Parts I and II of this work being the key to the difficulties in "
            "Part III, it is evidently very important that they should be thoroughly mastered "
            "before commencing the virtuoso studies contained in Part III."
        ),
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


def _detached(
    interval: int,
    base: str,
    rh_f: list[int],
    lh_f: list[int],
    ottava: list[tuple[int, int, int, int]],
    clefs: dict[int, list[tuple[int, str]]],
) -> list[Bar]:
    """No. 48, thirds (interval 2) or sixths (5): the wrist exercise, as printed.
    Lower notes of the right hand from `base` (C4 for thirds, E4 for sixths), the
    left hand an octave lower apart where the hands move apart. `ottava`: spans
    (bar, note, bar, note), 1-based bars and 0-based notes, under 8va; `clefs`:
    clef changes of the lower staff per bar (offset, clef)."""
    b = P(base).index

    def n(name: str) -> str:  # the same shape from `base`
        p = diatonic(P(name).index - P("C4").index + b)
        return f"{p.step}{p.octave}"

    def same(rh: list[int]) -> list[int]:
        return [i - 7 for i in rh]

    def rep(a: str, c: str) -> list[int]:
        return [P(n(a)).index] * 8 + [P(n(c)).index] * 8

    up16 = _line(n("C4"), 16)
    down16 = _fall_rise(n("E6"), 16, 0)
    notes = [
        (rep("C4", "D4"), same(rep("C4", "D4"))),
        (rep("E4", "F4"), same(rep("E4", "F4"))),
        (rep("E4", "F4"), same(rep("E4", "F4"))),
        (rep("E4", "D4"), same(rep("E4", "D4"))),
        (up16, same(up16)),
        (down16, same(down16)),
        (up16, _line(n("C3"), 9, 7)),
        (_fall_rise(n("E6"), 9, 7), _line(n("C3"), 16)),
        (_fall_rise(n("E6"), 9, 7), _fall_rise(n("E5"), 16, 0)),
        (down16, _line(n("C3"), 9, 7)),
        (_line(n("C4"), 9, 7), _fall_rise(n("C3"), 9, 7)),
        (_fall_rise(n("C4"), 9, 7), _fall_rise(n("C3"), 9, 7)),
    ]
    # Fingering as printed: the first four strokes and the second half of bar 1,
    # each half of bars 2-4, the first two strokes of the scales ("simile").
    fingered = {1: {0, 1, 2, 3, 8}, 2: {0, 8}, 3: {0, 8}, 4: {0, 8}, 5: {0, 1}}

    def under_8va(bar: int, i: int) -> bool:
        return any((b0, i0) <= (bar, i) <= (b1, i1) for b0, i0, b1, i1 in ottava)

    bars = []
    for k, (rh, lh) in enumerate(notes, 1):
        bar = Bar(
            [
                Event(
                    [diatonic(i), diatonic(i + interval)],
                    1,
                    rh_f if j in fingered.get(k, ()) else [],
                    None,
                    under_8va(k, j),
                )
                for j, i in enumerate(rh)
            ],
            [
                Event(
                    [diatonic(i), diatonic(i + interval)],
                    1,
                    lh_f if j in fingered.get(k, ()) else [],
                    2,
                )
                for j, i in enumerate(lh)
            ],
        )
        bar.clefs = [(2, at, sign) for at, sign in clefs.get(k, [])]
        bars.append(bar)
    bars[0].words += [(1, 4, "simile", "above"), (2, 4, "simile", "above")]
    bars[4].words += [(1, 2, "simile", "above"), (2, 2, "simile", "above")]
    bars[3].repeat_end = True
    bars[4].repeat_start = True
    bars[11].repeat_end = True
    return bars


def no48() -> Exercise:
    thirds = _detached(
        2,
        "C4",
        [2, 4],
        [4, 2],
        ottava=[(5, 12, 6, 3), (7, 14, 8, 3)],
        clefs={5: [(8, "G")], 6: [(8, "F")], 8: [(8, "G")], 9: [(8, "F")]},
    )
    sixths = _detached(
        5,
        "E4",
        [1, 5],
        [5, 1],
        ottava=[(5, 8, 6, 7), (7, 8, 8, 15), (9, 0, 10, 7)],
        clefs={
            5: [(4, "G")],
            6: [(14, "F")],
            7: [(4, "G"), (14, "F")],
            8: [(4, "G")],
            9: [(14, "F")],
            10: [(4, "G"), (14, "F")],
        },
    )
    sixths[0].words += [
        (1, 0, "Detached Sixths. Same remarks as for the thirds.", "above"),
        (1, 0, "(M.M. ♩ = 40 to 84)", "above"),
    ]
    bars = thirds + sixths
    bars.append(
        Bar(
            [Event([P("E4"), P("C5")], 16, [], 1)],
            [Event([P("E3"), P("C4")], 16, [], 2)],
            final=True,
        )
    )
    return Exercise(
        48,
        "Hanon n. 48",
        "Esercizio di polso: terze e seste staccate, il braccio fermo e il polso morbido.",
        "♩ = 40–84",
        4,
        4,
        bars,
        "78–79",
        bpm=40,
        tempo_words="(M.M. ♩ = 40 to 84)",
        auto_staff=(1,),
        heading=(
            "Wrist-exercise. Detached Thirds and Sixths. Lift the wrists well after each "
            "stroke, holding the arms perfectly quiet; the wrist should be supple, and the "
            "fingers firm without stiffness. Practise the first four measures until an easy "
            "wrist-movement is obtained; then take up the rest of the exercise."
        ),
    )


def _legato_thirds() -> list[Bar]:
    """No. 50, first part: groups of four thirds (k, k+1, k+2, k+1), the right
    hand an octave above the left; up from C3 for 22 groups, turn, down to E3."""
    c3 = P("C3").index
    up_rh, up_lh = [1, 3], [5, 3]  # fingers low note first (printed 3 over 1, 3 over 5)
    down_rh, down_lh = [3, 5], [3, 1]
    # The page's full formula, used in bar 1 and at the turns.
    rise_rh = [[1, 3], [2, 4], [3, 5], [2, 4], [1, 3]]
    rise_lh = [[5, 3], [4, 2], [3, 1], [4, 2], [5, 3]]
    turn_rh = [[3, 5], [2, 4], [1, 3], [2, 4], [3, 5]]
    turn_lh = [[3, 1], [4, 2], [5, 3], [4, 2], [3, 1]]

    def group(k: int, up: bool) -> list[int]:
        return [k, k + 1, k + 2, k + 1] if up else [k + 2, k + 1, k, k + 1]

    def bar_of(
        lows: list[int], rf: dict[int, list[int]], lf: dict[int, list[int]], ottava=False
    ) -> Bar:
        return Bar(
            [
                Event([diatonic(i), diatonic(i + 2)], 1, rf.get(j, []), None, ottava)
                for j, i in enumerate(lows)
            ],
            [
                Event([diatonic(i - 7), diatonic(i - 5)], 1, lf.get(j, []), None, ottava)
                for j, i in enumerate(lows)
            ],
        )

    every4 = lambda f: {0: f, 4: f, 8: f, 12: f}  # noqa: E731
    first = [c3, c3 + 1, c3 + 2, c3 + 1] * 4
    bars = [bar_of(first, dict(enumerate(rise_rh)), dict(enumerate(rise_lh)))]
    bars += [bar_of(first, {}, {}) for _ in range(3)]
    bars[3].repeat_end = True
    ups = [(c3 + k, True) for k in range(22)]  # C3 ... C6
    downs = [(c3 + 21 - k, False) for k in range(22)]  # tops E6 ... E3
    groups = ups + downs
    for b in range(0, len(groups), 4):
        chunk = groups[b : b + 4]
        lows = [i for k, up in chunk for i in group(k, up)]
        n = b // 4 + 5  # bar number
        if n == 5:
            rf = {**dict(enumerate(rise_rh)), 8: up_rh, 12: up_rh}
            lf = every4(up_lh)
        elif n < 10:
            rf, lf = every4(up_rh), every4(up_lh)
        elif n == 10:
            rf = {0: up_rh, 4: up_rh, **{8 + j: f for j, f in enumerate(turn_rh)}}
            lf = {0: up_lh, 4: up_lh, **{8 + j: f for j, f in enumerate(turn_lh)}}
        else:
            rf, lf = every4(down_rh), every4(down_lh)
        bars.append(bar_of(lows, rf, lf, ottava=n == 10))
    bars[4].repeat_start = True
    bars[-1].repeat_end = True
    return bars


def no50() -> Exercise:
    bars = _legato_thirds()
    return Exercise(
        50,
        "Hanon n. 50",
        "Terze legate: ogni nota uguale e ben distinta; poi le scale in terze e le terze "
        "minori cromatiche.",
        "♩ = 40–84",
        4,
        4,
        bars,
        "81–82",
        bpm=40,
        tempo_words="(M.M. ♩ = 40 to 84)",
        auto_staff=(1, 2),
        heading=(
            "Legato Thirds. We recommend careful study of this exercise, as Thirds occupy a "
            "very important place in difficult music. All notes must be struck evenly and very "
            "distinctly."
        ),
    )


def advanced() -> list[Exercise]:
    return [no43(), no48(), no50()]
