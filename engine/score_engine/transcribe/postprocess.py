"""Frame-level model outputs -> note and pedal events.

Ported from piano_transcription_inference (utilities.RegressionPostProcessor and
piano_vad), Copyright (c) 2020 Qiuqiang Kong / ByteDance, MIT License; see
Kong et al., "High-resolution Piano Transcription with Pedals by Regressing
Onsets and Offsets Times", IEEE/ACM TASLP 2021. The binarisation is vectorised
with numpy; the event logic is unchanged.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

FRAMES_PER_SECOND = 100
BEGIN_NOTE = 21  # A0
VELOCITY_SCALE = 128
ONSET_THRESHOLD = 0.3
OFFSET_THRESHOLD = 0.3
FRAME_THRESHOLD = 0.1
PEDAL_OFFSET_THRESHOLD = 0.2


@dataclass(frozen=True)
class NoteEvent:
    onset: float  # seconds
    offset: float
    pitch: int  # MIDI
    velocity: int  # 1-127


@dataclass(frozen=True)
class PedalEvent:
    onset: float
    offset: float


def binarize(reg: np.ndarray, threshold: float, neighbour: int) -> tuple[np.ndarray, np.ndarray]:
    """Peaks of a regression map (frames, classes): 1 at each local maximum above
    `threshold` that rises/falls monotonically over `neighbour` frames, plus the
    sub-frame shift of the peak."""
    frames = reg.shape[0]
    binary = np.zeros_like(reg)
    shift = np.zeros_like(reg)
    if frames <= 2 * neighbour:
        return binary, shift
    n = np.arange(neighbour, frames - neighbour)
    x = reg[n]
    ok = x > threshold
    for i in range(neighbour):
        ok &= reg[n - i] >= reg[n - i - 1]  # rising into the peak
        ok &= reg[n + i] >= reg[n + i + 1]  # falling after it
    rows, cols = np.nonzero(ok)
    frames_at = n[rows]
    centre = reg[frames_at, cols]
    before = reg[frames_at - 1, cols]
    after = reg[frames_at + 1, cols]
    with np.errstate(divide="ignore", invalid="ignore"):
        s = np.where(
            before > after,
            (after - before) / (centre - after) / 2,
            (after - before) / (centre - before) / 2,
        )
    binary[frames_at, cols] = 1
    shift[frames_at, cols] = np.nan_to_num(s)
    return binary, shift


def _notes_for_pitch(
    frame, onset, onset_shift, offset, offset_shift, velocity
) -> list[list[float]]:
    tuples: list[list[float]] = []
    bgn = None
    frame_disappear = None
    offset_occur = None
    last = onset.shape[0] - 1
    for i in range(onset.shape[0]):
        if onset[i] == 1:
            if bgn:  # consecutive onsets (e.g. pedal held, note repeated)
                fin = max(i - 1, 0)
                tuples.append([bgn, fin, onset_shift[bgn], 0, velocity[bgn]])
                frame_disappear, offset_occur = None, None
            bgn = i
        if bgn and i > bgn:
            if frame[i] <= FRAME_THRESHOLD and not frame_disappear:
                frame_disappear = i
            if offset[i] == 1 and not offset_occur:
                offset_occur = i
            if frame_disappear:
                if offset_occur and offset_occur - bgn > frame_disappear - offset_occur:
                    fin = offset_occur
                else:
                    fin = frame_disappear
                tuples.append([bgn, fin, onset_shift[bgn], offset_shift[fin], velocity[bgn]])
                bgn, frame_disappear, offset_occur = None, None, None
            if bgn and (i - bgn >= 600 or i == last):
                fin = i
                tuples.append([bgn, fin, onset_shift[bgn], offset_shift[fin], velocity[bgn]])
                bgn, frame_disappear, offset_occur = None, None, None
    return tuples


def detect_notes(outputs: dict[str, np.ndarray], lead_in: float = 0.0) -> list[NoteEvent]:
    """Notes from the model's maps; `lead_in` seconds of added silence are subtracted."""
    onset, onset_shift = binarize(outputs["reg_onset"], ONSET_THRESHOLD, 2)
    offset, offset_shift = binarize(outputs["reg_offset"], OFFSET_THRESHOLD, 4)
    frame = outputs["frame"]
    velocity = outputs["velocity"]
    notes: list[NoteEvent] = []
    for k in np.nonzero(onset.any(axis=0))[0]:
        for bgn, fin, s_on, s_off, vel in _notes_for_pitch(
            frame[:, k],
            onset[:, k],
            onset_shift[:, k],
            offset[:, k],
            offset_shift[:, k],
            velocity[:, k],
        ):
            notes.append(
                NoteEvent(
                    onset=max(0.0, float((bgn + s_on) / FRAMES_PER_SECOND) - lead_in),
                    offset=max(0.0, float((fin + s_off) / FRAMES_PER_SECOND) - lead_in),
                    pitch=int(k) + BEGIN_NOTE,
                    velocity=max(1, min(127, int(vel * VELOCITY_SCALE))),
                )
            )
    notes.sort(key=lambda n: (n.onset, n.pitch))
    return notes


def detect_pedals(outputs: dict[str, np.ndarray], lead_in: float = 0.0) -> list[PedalEvent]:
    frame = outputs["pedal_frame"][:, 0]
    offset, offset_shift = binarize(outputs["reg_pedal_offset"], PEDAL_OFFSET_THRESHOLD, 4)
    offset, offset_shift = offset[:, 0], offset_shift[:, 0]
    tuples = []
    bgn = None
    frame_disappear = None
    offset_occur = None
    for i in range(1, frame.shape[0]):
        if frame[i] >= 0.5 and frame[i] > frame[i - 1] and not bgn:
            bgn = i
        if bgn and i > bgn:
            if frame[i] <= 0.5 and not frame_disappear:
                frame_disappear = i
            if offset[i] == 1 and not offset_occur:
                offset_occur = i
            if offset_occur:
                tuples.append((bgn, offset_occur, offset_shift[offset_occur]))
                bgn, frame_disappear, offset_occur = None, None, None
            if frame_disappear and i - frame_disappear >= 10:
                tuples.append((bgn, frame_disappear, offset_shift[frame_disappear]))
                bgn, frame_disappear, offset_occur = None, None, None
    return [
        PedalEvent(
            onset=max(0.0, b / FRAMES_PER_SECOND - lead_in),
            offset=max(0.0, float((f + s) / FRAMES_PER_SECOND) - lead_in),
        )
        for b, f, s in sorted(tuples)
    ]
