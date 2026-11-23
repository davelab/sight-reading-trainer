"""How the printed page writes Part I (nos. 1, 2, 13, 20), read bar by bar from
the scanned Schirmer edition: on which staff each note stands (the right hand
often written on the lower staff, beams crossing between the staves), every
fingering, and the words on the page.

Per bar, one character per sixteenth: staff "1" upper / "2" lower; fingers a
digit, "." for none. Bars are numbered as in the exercise (final note last).
"""

from __future__ import annotations


def per_bar(total: int, spec: dict[str, str], default: str) -> list[str]:
    """{'1-5': 'x', '6': 'y'} -> one value per bar (1-based ranges)."""
    out = [default] * total
    for key, value in spec.items():
        a, _, b = key.partition("-")
        for n in range(int(a), int(b or a) + 1):
            out[n - 1] = value
    return out


ALL1 = "1" * 8
ALL2 = "2" * 8
NONE = "." * 8

PART_ONE = {
    1: {
        "bars": 29,
        "rh_staff": {"1-5": ALL2, "6": "22111111", "7-22": ALL1, "23": "11122222", "24-29": ALL2},
        "lh_staff": {},
        "rh_f": {
            "1-2": "12345...",
            "3-11": "12......",
            "15": "54321...",
            "16-29": "54......",
        },
        "lh_f": {
            "1-2": "54321...",
            "3-11": "54......",
            "15": "12345...",
            "16-29": "12......",
        },
        "words": {1: "ascending", 15: "descending"},
        "dynamic": {1: "mf"},
        "tempo": "(M.M. ♩ = 60 to 108.)",
        "final_words": "As soon as Ex. 1 is mastered, go on to Ex 2 without stopping on this note.",
    },
    2: {
        "bars": 28,
        "rh_staff": {"1-5": ALL2, "6": "22111111", "7-22": ALL1, "23": "11222222", "24-28": ALL2},
        "lh_staff": {},
        "rh_f": {
            "1": "12543432",
            "2-3": "125.....",
            "4-14": "12......",
            "15": "52123234",
            "16-23": "521.....",
            "24-28": "52......",
        },
        "lh_f": {
            "1": "53123234",
            "2-4": "531.....",
            "5-14": "53......",
            "15": "13543432",
            "16-23": "135.....",
            "24-28": "13......",
        },
        "words": {},
        "dynamic": {},
        "tempo": "",
        "final_words": "",
    },
    13: {
        "bars": 28,
        "rh_staff": {"1-5": ALL2, "6": "22221111", "7-23": ALL1, "24": "11111222", "25-28": ALL2},
        "lh_staff": {},
        "rh_f": {
            "1-2": "31425345",
            "3": "31425...",
            "4-14": "31......",
            "15-16": "35243134",
            "17-19": "35...134",
            "20-28": ".....134",
        },
        "lh_f": {
            "1-2": "35241321",
            "3": "35241...",
            "4-14": "35......",
            "15-16": "31423532",
            "17-19": "31...532",
            "20-28": ".....532",
        },
        "words": {1: "(3-4-5)"},
        "dynamic": {},
        "tempo": "",
        "final_words": "",
    },
    20: {
        "bars": 30,
        "rh_staff": {
            "1-2": ALL2,
            "3": "22111111",
            "4": "21111111",
            "5-26": ALL1,
            "27-30": "11222222",
        },
        "lh_staff": {"11": "22111111", "12-20": ALL1, "21-23": "11222222"},
        "rh_f": {
            "1-2": "12454342",
            "3": "12454..2",
            "4": "12454...",
            "5-6": "12454..2",
            "7": "124.4...",
            "8-15": "124....2",
            "16": "54213231",
            "17-26": "54213...",
            "27-30": "542.3...",
        },
        "lh_f": {
            "1-2": "54212324",
            "3": "54212..4",
            "4": "54212...",
            "5-10": "5421...4",
            "11-15": "542....4",
            "16": "12453435",
            "17-30": "12453...",
        },
        "words": {},
        "dynamic": {},
        "tempo": "",
        "final_words": "",
    },
}

HEADINGS = {
    1: (
        "Part I. Preparatory Exercises for the Acquirement of Agility, Independence, "
        "Strength and Perfect Evenness in the Fingers. — No. 1. Stretch between the fifth "
        "and fourth fingers of the left hand in ascending, and the fifth and fourth fingers "
        "of the right hand in descending. For studying the 20 exercises in this First Part, "
        "begin with the metronome set at 60, gradually increasing the speed up to 108; this "
        "is the meaning of the double metronome-mark at the head of each exercise. Lift the "
        "fingers high and with precision, playing each note very distinctly."
    ),
    2: (
        "(3-4) When this exercise is mastered, recommence the preceding one, and play both "
        "together four times without interruption; the fingers will gain considerably by "
        "practising these exercises, and those following, in this way."
    ),
    13: "(3-4-5)",
    20: "Extension of 2-4, 4-5, and exercise for 2-3-4.",
}

NOTES = {
    1: (
        "(1) For brevity, we shall henceforward indicate only by their figures those fingers "
        "which are to be specially trained in each exercise; e.g., 3-4 in No 2; 2-3-4 in No 3, "
        "etc. Observe that, throughout the book, both hands are continually executing the same "
        "difficulties; in this way the left hand becomes as skilful as the right. Besides, the "
        "difficulties executed by the left hand in ascending, are exactly copied by the same "
        "fingers of the right hand in descending; this new style of exercise will cause the "
        "hands to acquire perfect equality."
    ),
    2: (
        "(1) The fourth and fifth fingers being naturally weak, it should be observed that this "
        "exercise, and those following it up to No 31, are intended to render them as strong "
        "and agile as the second and third."
    ),
    20: (
        "End of Part I. After having mastered this First Part, play it through once or twice "
        'daily for some time before commencing the study of the Second ("transcendent") Part; '
        "by so doing, one is sure to obtain every possible advantage that this work promises. "
        "Complete mastery of Part I gives the key to the difficulties found in Part II."
    ),
}
