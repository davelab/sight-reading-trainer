"""The performance as a Standard MIDI File (format 0), times as played."""

from __future__ import annotations

import struct

from .postprocess import NoteEvent, PedalEvent

TICKS_PER_QUARTER = 480
TEMPO_US = 500_000  # 120 bpm: one tick = 1/960 s
TICKS_PER_SECOND = TICKS_PER_QUARTER * 1_000_000 / TEMPO_US


def _vlq(n: int) -> bytes:
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.append(0x80 | (n & 0x7F))
        n >>= 7
    return bytes(reversed(out))


def to_midi(notes: list[NoteEvent], pedals: list[PedalEvent] | None = None) -> bytes:
    events: list[tuple[int, int, bytes]] = []  # (tick, order, message); offs before ons
    for n in notes:
        on = round(n.onset * TICKS_PER_SECOND)
        off = max(on + 1, round(n.offset * TICKS_PER_SECOND))
        events.append((on, 1, bytes([0x90, n.pitch, max(1, min(127, n.velocity))])))
        events.append((off, 0, bytes([0x80, n.pitch, 0])))
    for p in pedals or []:
        events.append((round(p.onset * TICKS_PER_SECOND), 1, bytes([0xB0, 64, 127])))
        events.append((round(p.offset * TICKS_PER_SECOND), 0, bytes([0xB0, 64, 0])))
    events.sort(key=lambda e: (e[0], e[1]))
    track = bytearray(b"\x00\xff\x51\x03" + TEMPO_US.to_bytes(3, "big"))
    track += b"\x00\xc0\x00"  # acoustic grand piano
    now = 0
    for tick, _, msg in events:
        track += _vlq(max(0, tick - now)) + msg
        now = max(now, tick)
    track += b"\x00\xff\x2f\x00"
    header = b"MThd" + struct.pack(">IHHH", 6, 0, 1, TICKS_PER_QUARTER)
    return header + b"MTrk" + struct.pack(">I", len(track)) + bytes(track)
