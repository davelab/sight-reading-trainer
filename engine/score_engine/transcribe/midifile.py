"""A MIDI file -> the notes, pedal and grid the notation stage needs.

Two kinds of MIDI files:
- written on a grid (exported by MuseScore, Sibelius, a sequencer): every note
  starts on a fine subdivision of the beat. Its own beats are exact, and so are
  its time and key signatures: the notation uses them as they are;
- played (recorded from a digital piano): notes anywhere in time, often a single
  default tempo. It goes the way of an audio transcription: beat tracking,
  meter, quantization.
Drums (channel 10) are left out.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from ..models import TranscribeHints
from .postprocess import NoteEvent, PedalEvent

GRID_DIVISION = 24  # a 24th of a quarter: 32nds and sixteenth triplets
ON_GRID_SHARE = 0.9  # notes on that grid for the file to count as written on it

MIDI_SUFFIXES = {".mid", ".midi", ".kar"}
KEYS_MAJOR = {"C", "G", "D", "A", "E", "B", "F#", "C#", "F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb"}


class MidiError(ValueError):
    pass


@dataclass
class MidiScore:
    notes: list[NoteEvent]
    pedals: list[PedalEvent]
    duration: float
    on_grid: bool
    grid: np.ndarray | None  # quarter-note beat times (s) when on_grid
    hints: TranscribeHints = field(default_factory=TranscribeHints)


def _key_hint(name: str) -> str | None:
    """mido key names ('G', 'Em', 'Bb', 'F#m') -> 'G major', 'E minor'."""
    minor = name.endswith("m")
    tonic = name[:-1] if minor else name
    if tonic not in KEYS_MAJOR and not minor:
        return None
    if len(tonic) > 2 or tonic[:1] not in "ABCDEFG":
        return None
    return f"{tonic} {'minor' if minor else 'major'}"


def read_midi(path: Path) -> MidiScore:
    import mido

    try:
        mid = mido.MidiFile(str(path))
    except Exception as e:  # mido raises several error types on broken files
        raise MidiError(f"file MIDI non leggibile: {e}") from e
    tpq = mid.ticks_per_beat
    # Absolute ticks of every message, all tracks merged; tempo map for tick -> s.
    events: list[tuple[int, object]] = []
    for track in mid.tracks:
        tick = 0
        for msg in track:
            tick += msg.time
            events.append((tick, msg))
    events.sort(key=lambda e: e[0])
    tempo_changes = [(0, 500_000)]
    for tick, msg in events:
        if msg.type == "set_tempo":  # type: ignore[attr-defined]
            if tick == tempo_changes[-1][0]:
                tempo_changes[-1] = (tick, msg.tempo)  # type: ignore[attr-defined]
            else:
                tempo_changes.append((tick, msg.tempo))  # type: ignore[attr-defined]
    starts = [0.0]
    for (t0, us), (t1, _) in zip(tempo_changes, tempo_changes[1:], strict=False):
        starts.append(starts[-1] + (t1 - t0) * us / tpq / 1e6)

    def seconds(tick: float) -> float:
        i = max(j for j, (t, _) in enumerate(tempo_changes) if t <= tick)
        t0, us = tempo_changes[i]
        return starts[i] + (tick - t0) * us / tpq / 1e6

    notes: list[tuple[int, int, int, int]] = []  # on tick, off tick, pitch, velocity
    pedals: list[tuple[int, int]] = []
    held: dict[tuple[int, int], list[tuple[int, int]]] = {}
    pedal_on: dict[int, int] = {}
    hints = TranscribeHints()
    for tick, msg in events:
        kind = msg.type  # type: ignore[attr-defined]
        if kind == "time_signature" and hints.beats_per_measure is None:
            quarters = msg.numerator * 4 / msg.denominator  # type: ignore[attr-defined]
            if quarters in (2, 3, 4):
                hints.beats_per_measure = int(quarters)
        elif kind == "key_signature" and hints.key is None:
            hints.key = _key_hint(msg.key)  # type: ignore[attr-defined]
        if getattr(msg, "channel", None) == 9:
            continue
        if kind == "note_on" and msg.velocity > 0:  # type: ignore[attr-defined]
            held.setdefault((msg.channel, msg.note), []).append((tick, msg.velocity))  # type: ignore[attr-defined]
        elif kind in ("note_off", "note_on"):
            stack = held.get((msg.channel, msg.note))  # type: ignore[attr-defined]
            if stack:
                on, velocity = stack.pop(0)
                if tick > on:
                    notes.append((on, tick, msg.note, velocity))  # type: ignore[attr-defined]
        elif kind == "control_change" and msg.control == 64:  # type: ignore[attr-defined]
            if msg.value >= 64 and msg.channel not in pedal_on:  # type: ignore[attr-defined]
                pedal_on[msg.channel] = tick  # type: ignore[attr-defined]
            elif msg.value < 64 and msg.channel in pedal_on:  # type: ignore[attr-defined]
                pedals.append((pedal_on.pop(msg.channel), tick))  # type: ignore[attr-defined]
    if not notes:
        raise MidiError("il file MIDI non contiene note")
    notes.sort()
    last_tick = max(off for _, off, _, _ in notes)
    unit = tpq / GRID_DIVISION
    on_grid = tpq % GRID_DIVISION == 0 and sum(
        1 for on, *_ in notes if on % unit == 0
    ) >= ON_GRID_SHARE * len(notes)
    grid = None
    if on_grid:
        count = int(np.ceil(last_tick / tpq)) + 8
        grid = np.array([seconds(k * tpq) for k in range(count)])
        quarter_s = [(b - a) for a, b in zip(grid, grid[1:], strict=False)]
        bpm = round(60 / float(np.median(quarter_s)))
        hints.tempo = bpm if 20 <= bpm <= 300 else None
    return MidiScore(
        notes=[NoteEvent(seconds(a), seconds(b), p, v) for a, b, p, v in notes],
        pedals=[PedalEvent(seconds(a), seconds(b)) for a, b in pedals],
        duration=seconds(last_tick),
        on_grid=on_grid,
        grid=grid,
        hints=hints,
    )
