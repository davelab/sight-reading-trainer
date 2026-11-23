"""Piano separation jobs: song -> piano.wav + the song without the piano.

`separate.run` returns a job id at once; the job then sends
  separate.progress {jobId, stage, fraction}
and finally either
  separate.done   SeparateResult
or
  separate.failed {jobId, message, cancelled}.
The model is downloaded on first use (stage "download") into the data dir.
"""

from __future__ import annotations

import hashlib
import logging
import threading
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np

from ..models import SeparateProgress, SeparateResult, SeparationModelInfo, SeparationModels
from .registry import MODELS, SeparationModel

log = logging.getLogger("score_engine.separate")

Notify = Callable[[str, dict[str, Any]], None]
Progress = Callable[[str, float], None]
AUDIO_SUFFIXES = {".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".aif", ".aiff", ".caf"}


class Cancelled(Exception):
    pass


def models_dir() -> Path:
    from ..omr.jobs import data_dir

    return data_dir() / "models"


def model_file(model: SeparationModel) -> Path:
    return models_dir() / model.file


def list_models() -> SeparationModels:
    return SeparationModels(
        models=[
            SeparationModelInfo(
                id=m.id,  # type: ignore[arg-type]
                name=m.name,
                sizeBytes=m.size,
                installed=model_file(m).is_file(),
                licence=m.licence,
            )
            for m in MODELS.values()
        ]
    )


def _ssl_context():
    """The system's certificates (macOS keychain) when possible, else certifi's."""
    import ssl

    try:
        import truststore

        return truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    except ImportError:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())


def download(model: SeparationModel, progress: Progress, cancelled: Callable[[], bool]) -> Path:
    """Fetch the model once, checking size and SHA-256; a partial file is resumed."""
    import urllib.error
    import urllib.request

    dest = model_file(model)
    if dest.is_file():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    have = part.stat().st_size if part.exists() else 0
    request = urllib.request.Request(model.url, headers={"User-Agent": "score-studio"})
    if have:
        request.add_header("Range", f"bytes={have}-")
    progress("download", have / model.size)
    try:
        response = urllib.request.urlopen(request, timeout=60, context=_ssl_context())
    except urllib.error.HTTPError as e:
        if e.code == 416:  # already complete
            response = None
        else:
            raise RuntimeError(f"download del modello non riuscito (HTTP {e.code})") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"download del modello non riuscito: {e.reason}") from e
    if response is not None:
        with response, part.open("ab" if have and response.status == 206 else "wb") as f:
            if response.status != 206:
                have = 0  # the server ignored the range: start over
            while chunk := response.read(1 << 20):
                if cancelled():
                    raise Cancelled
                f.write(chunk)
                have += len(chunk)
                progress("download", min(1.0, have / model.size))
    digest = hashlib.sha256()
    with part.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    if part.stat().st_size != model.size or digest.hexdigest() != model.sha256:
        part.unlink(missing_ok=True)
        raise RuntimeError("il modello scaricato è danneggiato: riprova")
    part.rename(dest)
    return dest


def load_stereo(path: Path, rate: int) -> np.ndarray:
    """Any audio file -> (2, samples) float32 at `rate` (mono is duplicated)."""
    import soundfile as sf

    from ..transcribe.audio import AudioError, _convert_to_wav, resample

    try:
        data, sr = sf.read(str(path), dtype="float32", always_2d=True)
    except (sf.LibsndfileError, RuntimeError, TypeError):
        import tempfile

        with tempfile.TemporaryDirectory(prefix="score-studio-audio-") as tmp:
            wav = Path(tmp) / "audio.wav"
            _convert_to_wav(path, wav)
            data, sr = sf.read(str(wav), dtype="float32", always_2d=True)
    if data.size == 0:
        raise AudioError(f"{path.name}: nessun audio")
    if data.shape[1] == 1:
        data = np.repeat(data, 2, axis=1)
    data = data[:, :2]
    return np.stack([resample(data[:, c], sr, rate) for c in range(2)])


def output_paths(audio: Path, out_dir: Path) -> tuple[Path, Path]:
    return out_dir / f"{audio.stem} - piano.wav", out_dir / f"{audio.stem} - senza piano.wav"


def separate(
    audio: Path,
    model_id: str,
    out_dir: Path,
    job_id: str = "",
    progress: Progress = lambda *_: None,
    cancelled: Callable[[], bool] = lambda: False,
) -> SeparateResult:
    import soundfile as sf

    from .runner import SAMPLE_RATE, Separator

    model = MODELS[model_id]
    path = download(model, progress, cancelled)
    progress("load", 0.0)
    mix = load_stereo(audio, SAMPLE_RATE)
    separator = Separator(path)
    if cancelled():
        raise Cancelled

    def on_segment(fraction: float) -> None:
        if cancelled():
            raise Cancelled
        progress("separate", fraction)

    piano = separator.piano(mix, on_segment)
    progress("write", 0.0)
    out_dir.mkdir(parents=True, exist_ok=True)
    piano_path, rest_path = output_paths(audio, out_dir)
    # 24-bit WAV; float math may exceed full scale slightly, so clip.
    sf.write(str(piano_path), np.clip(piano, -1, 1).T, SAMPLE_RATE, subtype="PCM_24")
    sf.write(str(rest_path), np.clip(mix - piano, -1, 1).T, SAMPLE_RATE, subtype="PCM_24")
    progress("write", 1.0)
    return SeparateResult(
        jobId=job_id,
        model=model_id,  # type: ignore[arg-type]
        pianoPath=str(piano_path),
        restPath=str(rest_path),
        duration=mix.shape[1] / SAMPLE_RATE,
    )


class SeparateJobs:
    def __init__(self, notify: Notify) -> None:
        self.notify = notify
        self._cancel: dict[str, threading.Event] = {}
        self._lock = threading.Lock()
        # One separation at a time: each one uses every core and a lot of memory.
        self._busy = threading.Lock()

    def start(self, audio: Path, model_id: str, out_dir: Path) -> str:
        if audio.suffix.lower() not in AUDIO_SUFFIXES:
            raise ValueError(f"formato non supportato: {audio.suffix or audio.name}")
        if model_id not in MODELS:
            raise ValueError(f"modello sconosciuto: {model_id}")
        job_id = uuid.uuid4().hex[:12]
        cancel = threading.Event()
        with self._lock:
            self._cancel[job_id] = cancel
        threading.Thread(
            target=self._run,
            args=(job_id, audio, model_id, out_dir, cancel),
            name=f"sep-{job_id}",
            daemon=True,
        ).start()
        return job_id

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            event = self._cancel.get(job_id)
        if event:
            event.set()
        return event is not None

    def _run(
        self, job_id: str, audio: Path, model_id: str, out_dir: Path, cancel: threading.Event
    ) -> None:
        def progress(stage: str, fraction: float) -> None:
            payload = SeparateProgress(jobId=job_id, stage=stage, fraction=fraction)  # type: ignore[arg-type]
            self.notify("separate.progress", payload.model_dump(by_alias=True))

        try:
            with self._busy:
                result = separate(audio, model_id, out_dir, job_id, progress, cancel.is_set)
            self.notify("separate.done", result.model_dump(by_alias=True))
        except Cancelled:
            self.notify(
                "separate.failed",
                {"jobId": job_id, "message": "Separazione annullata", "cancelled": True},
            )
        except Exception as e:  # report everything to the app
            log.exception("separation job %s failed", job_id)
            self.notify("separate.failed", {"jobId": job_id, "message": str(e), "cancelled": False})
        finally:
            with self._lock:
                self._cancel.pop(job_id, None)
