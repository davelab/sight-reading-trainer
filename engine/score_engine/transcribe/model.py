"""Run the piano transcription model (ONNX) over a whole recording.

The model takes 10-second windows; like the original, windows overlap by half
and each keeps its middle part (the first keeps its start, the last its end).
"""

from __future__ import annotations

import os
from collections.abc import Callable
from pathlib import Path

import numpy as np

from .audio import SAMPLE_RATE

SEGMENT = SAMPLE_RATE * 10
OUTPUT_NAMES = [
    "reg_onset",
    "reg_offset",
    "frame",
    "velocity",
    "reg_pedal_onset",
    "reg_pedal_offset",
    "pedal_frame",
]
MODEL_FILE = "piano-transcription.onnx"
# Silence added before the audio: an onset in the very first frames cannot be
# detected (peak picking needs frames on both sides), so a piece that starts at
# 0 s would lose its first chord. Times are shifted back afterwards.
LEAD_IN_SECONDS = 0.5


class ModelMissing(RuntimeError):
    pass


def model_path() -> Path:
    """Where the converted model is: $SCORE_STUDIO_TRANSCRIPTION_MODEL, the app's
    resources, or the data dir (scripts/fetch-transcription-model.sh writes it)."""
    candidates = []
    if env := os.environ.get("SCORE_STUDIO_TRANSCRIPTION_MODEL"):
        candidates.append(Path(env))
    if res := os.environ.get("SCORE_STUDIO_RESOURCES"):
        candidates.append(Path(res) / "models" / MODEL_FILE)
    from ..omr.jobs import data_dir

    candidates.append(data_dir() / "models" / MODEL_FILE)
    here = Path(__file__).resolve()
    candidates.append(here.parents[3] / "app" / "src-tauri" / "resources" / "models" / MODEL_FILE)
    for c in candidates:
        if c.is_file():
            return c
    raise ModelMissing(
        "modello di trascrizione non trovato: esegui scripts/fetch-transcription-model.sh "
        "(lo converte una volta da quello pubblicato da ByteDance)"
    )


def enframe(audio: np.ndarray) -> np.ndarray:
    """Pad to whole 10 s windows and cut overlapping windows (hop 5 s)."""
    padded_len = int(np.ceil(len(audio) / SEGMENT)) * SEGMENT
    x = np.zeros(max(padded_len, SEGMENT), dtype=np.float32)
    x[: len(audio)] = audio
    return np.stack([x[p : p + SEGMENT] for p in range(0, len(x) - SEGMENT + 1, SEGMENT // 2)])


def deframe(x: np.ndarray) -> np.ndarray:
    """(windows, frames, classes) -> (frames, classes), keeping each window's middle."""
    if x.shape[0] == 1:
        return x[0]
    x = x[:, :-1, :]  # the spectrogram's centre padding adds a frame per window
    n = x.shape[1]
    parts = [x[0, : int(n * 0.75)]]
    parts += [x[i, int(n * 0.25) : int(n * 0.75)] for i in range(1, x.shape[0] - 1)]
    parts.append(x[-1, int(n * 0.25) :])
    return np.concatenate(parts, axis=0)


def run_model(
    audio: np.ndarray, progress: Callable[[float], None] = lambda f: None, path: Path | None = None
) -> dict[str, np.ndarray]:
    """Frame-level maps for `audio`, with LEAD_IN_SECONDS of silence before it."""
    import onnxruntime as ort

    session = ort.InferenceSession(str(path or model_path()), providers=["CPUExecutionProvider"])
    audio = np.concatenate([np.zeros(int(LEAD_IN_SECONDS * SAMPLE_RATE), np.float32), audio])
    windows = enframe(audio)
    outputs: dict[str, list[np.ndarray]] = {k: [] for k in OUTPUT_NAMES}
    for i, w in enumerate(windows):
        result = session.run(OUTPUT_NAMES, {"audio": w[None, :]})
        for k, v in zip(OUTPUT_NAMES, result, strict=True):
            outputs[k].append(v[0])
        progress((i + 1) / len(windows))
    frames = int(np.ceil(len(audio) / SAMPLE_RATE * 100)) + 1
    return {k: deframe(np.stack(v))[:frames] for k, v in outputs.items()}
