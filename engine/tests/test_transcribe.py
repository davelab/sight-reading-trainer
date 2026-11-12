"""Audio transcription. The neural model (154 MB, fetched at build time) is not
needed here: the notation stage gets the notes a performance of the Minuet in G
fixture would give, played strictly and with heavy rubato."""

import base64
import threading
import time
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

import numpy as np
import pytest

from score_engine.io.xml_walk import walk
from score_engine.models import TranscribeHints
from score_engine.transcribe import jobs as tx_jobs
from score_engine.transcribe import model as tx_model
from score_engine.transcribe.beats import to_beats, track_beats
from score_engine.transcribe.midi import TICKS_PER_SECOND, to_midi
from score_engine.transcribe.model import deframe, enframe
from score_engine.transcribe.notation import to_score
from score_engine.transcribe.postprocess import NoteEvent, PedalEvent, detect_notes, detect_pedals

MINUET = Path(__file__).parent / "fixtures" / "minuet-in-g.musicxml"
METER = 3


def score_notes() -> list[tuple[float, float, int]]:
    """(start, length) in quarters from the top, and pitch, of every note."""
    notes, _ = walk(ET.parse(MINUET).getroot())
    return [
        ((n.ref.measure - 1) * METER + float(n.ref.offset), float(n.duration), n.ref.midi)
        for n in notes
        if n.ref.midi
    ]


def perform(tempo_of_measure, seed: int = 0) -> list[NoteEvent]:
    """Play the minuet: tempo_of_measure(m) in bpm, a little timing jitter,
    downbeats and bass louder."""
    rng = np.random.default_rng(seed)
    quarters = int(max(s + d for s, d, _ in score_notes())) + 1
    seconds = np.concatenate(
        [[0.0], np.cumsum([60 / tempo_of_measure(q // METER) for q in range(quarters)])]
    )

    def at(q: float) -> float:
        return float(np.interp(q, np.arange(len(seconds)), seconds))

    out = []
    for start, length, pitch in score_notes():
        on = at(start) + rng.normal(0, 0.008)
        off = at(start + length) - 0.05
        loud = 90 if start % METER == 0 else 70
        out.append(
            NoteEvent(max(0.0, on), max(on + 0.05, off), pitch, loud - (0 if pitch < 55 else 10))
        )
    return sorted(out, key=lambda n: (n.onset, n.pitch))


def agreement(xml: str) -> float:
    ns, _ = walk(ET.fromstring(xml.encode()))
    got = Counter((n.ref.measure, n.ref.offset, n.ref.midi) for n in ns if n.ref.midi)
    ref, _ = walk(ET.parse(MINUET).getroot())
    want = Counter((n.ref.measure, n.ref.offset, n.ref.midi) for n in ref if n.ref.midi)
    return sum((got & want).values()) / sum(want.values())


def test_strict_performance_is_notated_exactly():
    xml, facts = to_score(perform(lambda m: 120), [])
    assert facts == {"tempo": 120, "beatsPerMeasure": 3, "key": "G major", "pickupBeats": 0.0}
    assert agreement(xml) == 1.0
    assert "<accidental>natural" not in xml  # white keys need no sign in G major
    assert "<tie " not in xml  # nothing rings past the last bar


def test_rubato_performance_keeps_meter_and_bars():
    """Tempo swinging between 95 and 145 bpm every few bars, then a ritardando to 50."""

    def tempo(m: int) -> float:
        return 120 + 25 * np.sin(m / 3) if m < 29 else (80, 65, 50)[min(m - 29, 2)]

    xml, facts = to_score(perform(tempo, seed=1), [])
    assert facts["beatsPerMeasure"] == 3
    assert facts["key"] == "G major"
    assert agreement(xml) >= 0.9


def test_beats_follow_a_tempo_change():
    notes = perform(lambda m: 100 + 40 * min(1, max(0, (m - 8) / 8)))  # accelerando, bars 9-16
    beats = track_beats(notes)
    periods = np.diff(beats)
    assert abs(np.median(periods[:30]) - 0.6) < 0.03
    assert abs(np.median(periods[-30:]) - 60 / 140) < 0.03
    x = to_beats(np.array([0.0, 0.3, 0.6]), np.array([0.0, 0.6, 1.2]))
    assert np.allclose(x, [0, 0.5, 1])


def test_pedal_marks_in_the_score():
    notes = perform(lambda m: 120)
    xml, _ = to_score(notes, [PedalEvent(0.0, 1.4), PedalEvent(1.5, 2.9)])
    assert xml.count('<pedal type="start"') == 2 and xml.count('<pedal type="stop"') == 2
    assert 'damper-pedal="yes"' in xml


def _peak(n: int, at: int) -> np.ndarray:
    frames = np.arange(n)
    return np.clip(1 - np.abs(frames - at) / 3, 0, None)


def test_postprocess_finds_notes_and_pedal():
    n = 300
    maps = {
        k: np.zeros((n, 88), np.float32) for k in ("reg_onset", "reg_offset", "frame", "velocity")
    }
    maps["reg_onset"][:, 60 - 21] = _peak(n, 100)
    maps["frame"][100:200, 60 - 21] = 0.9
    maps["reg_offset"][:, 60 - 21] = _peak(n, 200)
    maps["velocity"][:, 60 - 21] = 0.5
    maps["reg_pedal_onset"] = _peak(n, 90)[:, None].astype(np.float32)
    maps["reg_pedal_offset"] = _peak(n, 250)[:, None].astype(np.float32)
    maps["pedal_frame"] = np.zeros((n, 1), np.float32)
    maps["pedal_frame"][90:250] = 0.9
    [note] = detect_notes(maps, lead_in=0.5)
    assert note.pitch == 60 and abs(note.onset - 0.5) < 0.02 and abs(note.offset - 1.5) < 0.02
    assert 50 <= note.velocity <= 80
    [pedal] = detect_pedals(maps, lead_in=0.5)
    assert abs(pedal.onset - 0.4) < 0.02 and abs(pedal.offset - 2.0) < 0.02


def test_windows_cover_the_audio_once():
    audio = np.arange(16000 * 23, dtype=np.float32)
    w = enframe(audio)
    assert w.shape == (5, 160000)  # padded to 30 s, hop 5 s
    frames = np.stack([np.arange(1001)[:, None] + 500 * i for i in range(len(w))]).astype(float)
    joined = deframe(frames)
    assert np.array_equal(joined[:, 0], np.arange(len(joined)))


def test_midi_file():
    data = to_midi(
        [NoteEvent(0.0, 0.5, 60, 100), NoteEvent(0.5, 1.0, 64, 80)], [PedalEvent(0.0, 1.0)]
    )
    assert data[:4] == b"MThd" and data[14:18] == b"MTrk"
    from music21 import converter

    s = converter.parse(data, format="midi")
    pitches = [p.midi for n in s.recurse().notes for p in n.pitches]
    assert pitches == [60, 64]
    assert TICKS_PER_SECOND == 960


def test_job_reports_progress_and_result(tmp_path, monkeypatch):
    wav = tmp_path / "take.wav"
    import soundfile

    soundfile.write(wav, np.zeros(16000, np.float32), 16000)
    played = perform(lambda m: 120)

    def fake_model(samples, progress=lambda f: None, path=None):
        progress(0.5)
        progress(1.0)
        return {}

    monkeypatch.setattr(tx_model, "model_path", lambda: wav)
    monkeypatch.setattr(tx_model, "run_model", fake_model)
    monkeypatch.setattr(
        "score_engine.transcribe.postprocess.detect_notes", lambda maps, lead_in: played
    )
    monkeypatch.setattr(
        "score_engine.transcribe.postprocess.detect_pedals", lambda maps, lead_in: []
    )
    sent: list[tuple[str, dict]] = []
    done = threading.Event()

    def notify(method, params):
        sent.append((method, params))
        if method != "transcribe.progress":
            done.set()

    job = tx_jobs.TranscribeJobs(notify).start(wav)
    assert done.wait(60)
    method, result = sent[-1]
    assert method == "transcribe.done", result
    assert result["jobId"] == job and result["facts"]["beatsPerMeasure"] == 3
    assert result["notes"] == len(played) and result["warnings"] == []
    assert base64.b64decode(result["midi"])[:4] == b"MThd"
    stages = [p["stage"] for m, p in sent if m == "transcribe.progress"]
    assert stages[0] == "load" and "model" in stages and stages[-1] == "notation"


def test_job_cancel(tmp_path, monkeypatch):
    wav = tmp_path / "take.wav"
    import soundfile

    soundfile.write(wav, np.zeros(16000, np.float32), 16000)
    started = threading.Event()

    def slow_model(samples, progress=lambda f: None, path=None):
        started.set()
        for _ in range(200):
            time.sleep(0.01)
            progress(0.1)
        return {}

    monkeypatch.setattr(tx_model, "model_path", lambda: wav)
    monkeypatch.setattr(tx_model, "run_model", slow_model)
    sent: list[tuple[str, dict]] = []
    done = threading.Event()

    def notify(method, params):
        sent.append((method, params))
        if method != "transcribe.progress":
            done.set()

    runner = tx_jobs.TranscribeJobs(notify)
    job = runner.start(wav)
    assert started.wait(10) and runner.cancel(job)
    assert done.wait(10)
    assert sent[-1] == (
        "transcribe.failed",
        {"jobId": job, "message": "Trascrizione annullata", "cancelled": True},
    )


def test_rejects_non_audio(tmp_path):
    with pytest.raises(ValueError, match="formato audio"):
        tx_jobs.TranscribeJobs(lambda *_: None).start(tmp_path / "score.pdf")


def test_abrupt_tempo_change_is_followed():
    """100 bpm, then suddenly 140: the beat must not slide to a dotted pulse."""
    xml, facts = to_score(perform(lambda m: 100 if m < 16 else 140, seed=1), [])
    assert facts["beatsPerMeasure"] == 3
    assert agreement(xml) >= 0.95


def test_tempo_hint_resolves_a_fast_piece():
    """At 200 bpm the plain tracker hears half time; an approximate tempo fixes it."""
    notes = perform(lambda m: 200, seed=1)
    assert agreement(to_score(notes, [])[0]) < 0.5
    for guess in (180, 200, 220):
        xml, facts = to_score(notes, [], hints=TranscribeHints(tempo=guess))
        assert facts["beatsPerMeasure"] == 3 and abs(facts["tempo"] - 200) <= 5
        assert agreement(xml) >= 0.95


def test_meter_pickup_and_key_hints():
    # The piece starts on the third beat of the first bar: a one-beat pickup.
    late = [n for n in perform(lambda m: 110, seed=2) if n.onset >= 2 * 60 / 110 - 0.05]
    _, facts = to_score(late, [], hints=TranscribeHints(pickupBeats=1))
    assert facts["pickupBeats"] == 1.0
    _, facts = to_score(perform(lambda m: 120), [], hints=TranscribeHints(beatsPerMeasure=2))
    assert facts["beatsPerMeasure"] == 2
    xml, facts = to_score(perform(lambda m: 120), [], hints=TranscribeHints(key="E minor"))
    assert facts["key"] == "E minor" and "<fifths>1</fifths>" in xml


def test_hints_are_validated():
    with pytest.raises(ValueError):
        TranscribeHints.model_validate({"key": "H major"})
    with pytest.raises(ValueError):
        TranscribeHints.model_validate({"beatsPerMeasure": 7})
    assert TranscribeHints.model_validate({"key": "Bb minor", "tempo": 72}).tempo == 72
