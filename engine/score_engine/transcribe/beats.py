"""Beat tracking from transcribed notes (dynamic programming, after D. Ellis,
"Beat Tracking by Dynamic Programming", J. New Music Research 2007).

Two methods, both from the notes themselves:
- beat_period(): the overall period from the onset envelope's autocorrelation;
- track_beats(): beats that follow the performer, after S. Dixon's BeatRoot
  ("Automatic Extraction of Tempo and Beat from Expressive Performances",
  J. New Music Research 2001): tempo hypotheses from clusters of
  inter-onset intervals, then agents that predict the next beat, lock onto the
  strongest attack near the prediction and correct their tempo at once; the
  agent that explains the attacks best wins. Rubato, ritardando and
  accelerando are followed beat by beat.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .postprocess import NoteEvent

FPS = 100  # envelope frames per second


def onset_envelope(notes: list[NoteEvent], duration: float) -> np.ndarray:
    env = np.zeros(int(duration * FPS) + FPS)
    for n in notes:
        i = int(round(n.onset * FPS))
        if 0 <= i < len(env):
            bass = 1.5 if n.pitch < 55 else 1.0
            env[i] += (n.velocity / 127.0) * bass
    kernel = np.exp(-0.5 * (np.arange(-6, 7) / 2.0) ** 2)  # ~20 ms smoothing
    return np.convolve(env, kernel / kernel.sum(), mode="same")


def beat_period(env: np.ndarray) -> float:
    """Frames per beat: autocorrelation peak, weighted around 100 beats per minute."""
    lo, hi = int(0.3 * FPS), int(1.5 * FPS)  # 200 .. 40 bpm
    x = env - env.mean()
    ac = np.correlate(x, x, mode="full")[len(x) - 1 :]
    lags = np.arange(lo, hi + 1)
    bpm = 60 * FPS / lags
    prior = np.exp(-0.5 * (np.log2(bpm / 100.0) / 0.9) ** 2)
    best = lags[int(np.argmax(ac[lo : hi + 1] * prior))]
    # Refine to a fraction of a frame with a parabola through the peak.
    if lo < best < hi:
        a, b, c = ac[best - 1], ac[best], ac[best + 1]
        denom = a - 2 * b + c
        if denom != 0:
            return float(best + 0.5 * (a - c) / denom)
    return float(best)


@dataclass
class _Event:
    time: float
    salience: float


def onset_events(notes: list[NoteEvent]) -> list[_Event]:
    """Attacks within 30 ms are one event; salience = loudness, bass and chord size."""
    events: list[_Event] = []
    for n in sorted(notes, key=lambda n: n.onset):
        weight = (n.velocity / 127.0) * (1.6 if n.pitch < 55 else 1.0)
        if events and n.onset - events[-1].time <= 0.03:
            events[-1].salience += weight
        else:
            events.append(_Event(n.onset, weight))
    return events


def tempo_hypotheses(events: list[_Event], count: int = 6) -> list[float]:
    """Beat periods (s) from clusters of inter-onset intervals, as BeatRoot does."""
    iois = [
        b.time - a.time
        for i, a in enumerate(events)
        for b in events[i + 1 : i + 12]
        if 0.07 <= b.time - a.time <= 2.5
    ]
    if not iois:
        return [0.5]
    width = 0.025
    clusters: list[list[float]] = []
    for x in sorted(iois):
        if clusters and x - np.mean(clusters[-1]) <= width:
            clusters[-1].append(x)
        else:
            clusters.append([x])
    scored = []
    for c in clusters:
        period = float(np.mean(c))
        support = len(c)
        # Related clusters (integer ratios) support each other.
        for d in clusters:
            other = float(np.mean(d))
            for k in (2, 3, 4):
                if abs(other - period * k) < width * k or abs(other * k - period) < width * k:
                    support += len(d) / k
        while period < 0.3:
            period *= 2
        while period > 1.2:
            period /= 2
        bpm = 60 / period
        prior = np.exp(-0.5 * (np.log2(bpm / 100) / 0.8) ** 2)
        scored.append((support * prior, period))
    scored.sort(reverse=True)
    out: list[float] = []
    for _, p in scored:
        if all(abs(p - q) / q > 0.06 for q in out):
            out.append(p)
        if len(out) == count:
            break
    return out


CORRECTION = 0.6  # share of each timing error taken into the tempo
LEVEL_RANGE = (0.7, 2.5)  # the period stays within this factor of its start:
# wide enough for strong rubato, not for sliding to half or double the beat


def _run_agent(
    events: list[_Event], start: int, period: float, end: float, correction: float = CORRECTION
) -> tuple[float, list[float]]:
    """Follow the music from events[start] with an adapting period; returns (score, beats)."""
    lowest, highest = period * LEVEL_RANGE[0], period * LEVEL_RANGE[1]
    beat = events[start].time
    beats = [beat]
    score = events[start].salience
    j = start + 1
    while beat + period * 0.5 < end:
        predicted = beat + period
        window = 0.25 * period
        best, best_value = None, 0.0
        while j < len(events) and events[j].time < predicted - window:
            j += 1
        k = j
        while k < len(events) and events[k].time <= predicted + window:
            closeness = 1 - abs(events[k].time - predicted) / window
            value = events[k].salience * closeness
            if value > best_value:
                best, best_value = k, value
            k += 1
        if best is not None:
            error = events[best].time - predicted
            # follow the performer
            period = float(np.clip(period + correction * error, lowest, highest))
            beat = events[best].time
            score += best_value
            j = best + 1
        else:
            beat = predicted  # no attack on this beat: keep going at the current pace
        beats.append(beat)
    return score, beats


def track_beats(notes: list[NoteEvent], correction: float = CORRECTION) -> np.ndarray:
    """Beat times (s) covering the notes: the best of several agents, each started
    from a tempo hypothesis and one of the first attacks."""
    if not notes:
        return np.array([])
    events = onset_events(notes)
    end = max(n.offset for n in notes)
    first = events[0].time
    starts = [i for i, e in enumerate(events) if e.time - first <= 2.0][:8]
    best: tuple[float, list[float]] | None = None
    for period in tempo_hypotheses(events):
        for i in starts:
            score, beats = _run_agent(events, i, period, end, correction)
            if best is None or score > best[0]:
                best = (score, beats)
    beats = np.array(best[1] if best else [first])
    if len(beats) > 1 and beats[0] - first > 0.25 * (beats[1] - beats[0]):
        beats = np.concatenate([_track_back(events, beats), beats])
    return beats


def _track_back(events: list[_Event], beats: np.ndarray) -> np.ndarray:
    """Beats before the winning agent's first one, back to the first attack: the
    same agent run on the music reversed in time, so it follows the tempo there too."""
    origin = float(beats[0])
    mirrored = [
        _Event(origin - e.time, e.salience) for e in reversed(events) if e.time <= origin + 1e-6
    ]
    period = float(np.median(np.diff(beats[: min(len(beats), 5)])))
    span = origin - events[0].time
    _, back = _run_agent(mirrored, 0, period, span + 0.5 * period)
    times = origin - np.array(back[1:])
    times = times[times > events[0].time - 0.5 * period]
    return times[::-1]


def to_beats(times: np.ndarray, beats: np.ndarray) -> np.ndarray:
    """Seconds -> beat coordinate (beat i at beats[i]), linear beyond the ends."""
    idx = np.arange(len(beats), dtype=float)
    out = np.interp(times, beats, idx)
    before = times < beats[0]
    after = times > beats[-1]
    if len(beats) > 1:
        out[before] = (times[before] - beats[0]) / (beats[1] - beats[0])
        out[after] = idx[-1] + (times[after] - beats[-1]) / (beats[-1] - beats[-2])
    return out
