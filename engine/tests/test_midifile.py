"""MIDI file -> score: a file written on a grid keeps its grid and signatures;
a played one goes through beat tracking like an audio transcription."""

import threading

import mido
import numpy as np
import pytest

from score_engine.models import TranscribeHints
from score_engine.transcribe.jobs import TranscribeJobs, transcribe
from score_engine.transcribe.midi import to_midi
from score_engine.transcribe.midifile import MidiError, read_midi
from tests.test_transcribe import agreement, perform, score_notes

TPQ = 480


def written_midi(path, signatures=True, tempo_bpm=96, pickup_ticks=0):
    """The minuet as a notation program exports it: notes exactly on the grid."""
    mid = mido.MidiFile(ticks_per_beat=TPQ)
    meta = mido.MidiTrack()
    meta.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(tempo_bpm), time=0))
    if signatures:
        meta.append(mido.MetaMessage("time_signature", numerator=3, denominator=4, time=0))
        meta.append(mido.MetaMessage("key_signature", key="G", time=0))
    mid.tracks.append(meta)
    events = []
    for start, length, pitch in score_notes():
        on = round(start * TPQ) + pickup_ticks
        events += [(on, 1, pitch), (on + round(length * TPQ) - 10, 0, pitch)]
    events.append((0, 2, 0))  # a drum hit, to be ignored
    track = mido.MidiTrack()
    now = 0
    for tick, kind, pitch in sorted(events):
        if kind == 2:
            msg = mido.Message("note_on", channel=9, note=36, velocity=100)
        elif kind == 1:
            msg = mido.Message("note_on", note=pitch, velocity=70)
        else:
            msg = mido.Message("note_off", note=pitch, velocity=0)
        track.append(msg.copy(time=tick - now))
        now = tick
    mid.tracks.append(track)
    mid.save(str(path))
    return path


def test_written_file_keeps_its_grid_and_signatures(tmp_path):
    midi = read_midi(written_midi(tmp_path / "minuet.mid"))
    assert midi.on_grid and midi.hints.beats_per_measure == 3 and midi.hints.key == "G major"
    assert midi.hints.tempo == 96 and len(midi.notes) == len(score_notes())
    result = transcribe(tmp_path / "minuet.mid")
    assert result.facts.beats_per_measure == 3 and result.facts.tempo == 96
    assert result.facts.key == "G major" and result.warnings == []
    assert agreement(result.musicxml) == 1.0


def test_written_file_without_signatures_infers_them(tmp_path):
    result = transcribe(written_midi(tmp_path / "plain.mid", signatures=False))
    assert result.facts.beats_per_measure == 3 and result.facts.key == "G major"
    assert agreement(result.musicxml) == 1.0


def test_played_file_is_beat_tracked(tmp_path):
    """Recorded from a piano: smooth rubato, written by our own MIDI writer."""

    def tempo(m: int) -> float:
        return 120 + 25 * np.sin(m / 3) if m < 29 else (80, 65, 50)[min(m - 29, 2)]

    path = tmp_path / "played.mid"
    path.write_bytes(to_midi(perform(tempo, seed=1)))
    midi = read_midi(path)
    assert not midi.on_grid and midi.grid is None
    result = transcribe(path)
    assert result.facts.beats_per_measure == 3
    assert agreement(result.musicxml) >= 0.9


def test_user_hints_win_over_the_file(tmp_path):
    result = transcribe(written_midi(tmp_path / "m.mid"), hints=TranscribeHints(key="E minor"))
    assert result.facts.key == "E minor"


def test_broken_or_empty_files(tmp_path):
    bad = tmp_path / "bad.mid"
    bad.write_bytes(b"not midi")
    with pytest.raises(MidiError, match="non leggibile"):
        read_midi(bad)
    empty = tmp_path / "empty.mid"
    mido.MidiFile().save(str(empty))
    with pytest.raises(MidiError, match="non contiene note"):
        read_midi(empty)


def test_job_accepts_midi_without_the_model(tmp_path, monkeypatch):
    from score_engine.transcribe import model

    monkeypatch.setattr(
        model, "model_path", lambda: (_ for _ in ()).throw(AssertionError("not needed"))
    )
    done = threading.Event()
    sent = []

    def notify(method, params):
        sent.append((method, params))
        if method != "transcribe.progress":
            done.set()

    TranscribeJobs(notify).start(written_midi(tmp_path / "m.mid"))
    assert done.wait(60)
    assert sent[-1][0] == "transcribe.done"
