"""Transcription jobs: audio file -> score, in a background thread.

`transcribe.run` returns a job id at once; the job then sends
  transcribe.progress {jobId, stage, fraction}
and finally either
  transcribe.done   TranscribeResult
or
  transcribe.failed {jobId, message, cancelled}.
"""

from __future__ import annotations

import base64
import logging
import threading
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

from ..io.correct import check
from ..models import TranscribeFacts, TranscribeHints, TranscribeProgress, TranscribeResult

log = logging.getLogger("score_engine.transcribe")

Notify = Callable[[str, dict[str, Any]], None]
AUDIO_SUFFIXES = {".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".aif", ".aiff", ".caf"}


class Cancelled(Exception):
    pass


class TranscribeJobs:
    def __init__(self, notify: Notify) -> None:
        self.notify = notify
        self._cancel: dict[str, threading.Event] = {}
        self._lock = threading.Lock()

    def start(self, audio: Path, hints: TranscribeHints | None = None) -> str:
        if audio.suffix.lower() not in AUDIO_SUFFIXES:
            raise ValueError(f"formato audio non supportato: {audio.suffix or audio.name}")
        from .model import model_path

        model_path()  # fail fast (in the reply) when the model is not installed
        job_id = uuid.uuid4().hex[:12]
        cancel = threading.Event()
        with self._lock:
            self._cancel[job_id] = cancel
        threading.Thread(
            target=self._run, args=(job_id, audio, cancel, hints), name=f"tx-{job_id}", daemon=True
        ).start()
        return job_id

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            event = self._cancel.get(job_id)
        if event:
            event.set()
        return event is not None

    def _progress(self, job_id: str, stage: str, fraction: float) -> None:
        payload = TranscribeProgress(jobId=job_id, stage=stage, fraction=fraction)  # type: ignore[arg-type]
        self.notify("transcribe.progress", payload.model_dump(by_alias=True))

    def _run(
        self, job_id: str, audio: Path, cancel: threading.Event, hints: TranscribeHints | None
    ) -> None:
        try:
            result = transcribe(audio, job_id, cancel, self._progress, hints)
            self.notify("transcribe.done", result.model_dump(by_alias=True))
        except Cancelled:
            self.notify(
                "transcribe.failed",
                {"jobId": job_id, "message": "Trascrizione annullata", "cancelled": True},
            )
        except Exception as e:  # report everything to the app
            log.exception("transcription job %s failed", job_id)
            self.notify(
                "transcribe.failed", {"jobId": job_id, "message": str(e), "cancelled": False}
            )
        finally:
            with self._lock:
                self._cancel.pop(job_id, None)


def transcribe(
    audio: Path,
    job_id: str = "",
    cancel: threading.Event | None = None,
    progress: Callable[[str, str, float], None] = lambda *_: None,
    hints: TranscribeHints | None = None,
) -> TranscribeResult:
    from .audio import SAMPLE_RATE, load_audio
    from .midi import to_midi
    from .model import LEAD_IN_SECONDS, run_model
    from .notation import to_score
    from .postprocess import detect_notes, detect_pedals

    def check_cancel() -> None:
        if cancel is not None and cancel.is_set():
            raise Cancelled

    progress(job_id, "load", 0.0)
    samples = load_audio(audio)
    check_cancel()

    def on_window(fraction: float) -> None:
        check_cancel()
        progress(job_id, "model", fraction)

    maps = run_model(samples, on_window)
    progress(job_id, "notation", 0.0)
    notes = detect_notes(maps, LEAD_IN_SECONDS)
    pedals = detect_pedals(maps, LEAD_IN_SECONDS)
    if not notes:
        raise ValueError("nessuna nota di pianoforte riconosciuta nella registrazione")
    check_cancel()
    musicxml, facts = to_score(notes, pedals, title=audio.stem, hints=hints)
    progress(job_id, "notation", 1.0)
    return TranscribeResult(
        jobId=job_id,
        musicxml=musicxml,
        midi=base64.b64encode(to_midi(notes, pedals)).decode("ascii"),
        duration=len(samples) / SAMPLE_RATE,
        notes=len(notes),
        facts=TranscribeFacts(**facts),
        warnings=check(musicxml),
    )
