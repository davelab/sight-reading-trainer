"""Read an audio file as mono float32 at 16 kHz.

WAV, FLAC, OGG and MP3 are read by libsndfile (soundfile). Anything else
(M4A/AAC from a phone, for example) is first converted to WAV with macOS's
built-in `afconvert`, or `ffmpeg` if installed.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from math import gcd
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16000


class AudioError(ValueError):
    pass


def _convert_to_wav(path: Path, out: Path) -> None:
    if shutil.which("afconvert"):
        cmd = ["afconvert", "-f", "WAVE", "-d", "LEI16", str(path), str(out)]
    elif shutil.which("ffmpeg"):
        cmd = ["ffmpeg", "-loglevel", "error", "-y", "-i", str(path), str(out)]
    else:
        raise AudioError(
            f"formato audio non supportato: {path.suffix} (usa WAV, FLAC, MP3, OGG o M4A su macOS)"
        )
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        raise AudioError(f"impossibile convertire {path.name}: {result.stderr.strip()[:300]}")


def resample(audio: np.ndarray, rate: int, target: int = SAMPLE_RATE) -> np.ndarray:
    if rate == target:
        return audio.astype(np.float32)
    from scipy.signal import resample_poly

    g = gcd(rate, target)
    return resample_poly(audio, target // g, rate // g).astype(np.float32)


def load_audio(path: Path) -> np.ndarray:
    import soundfile as sf

    try:
        data, rate = sf.read(str(path), dtype="float32", always_2d=True)
    except (sf.LibsndfileError, RuntimeError, TypeError):
        with tempfile.TemporaryDirectory(prefix="score-studio-audio-") as tmp:
            wav = Path(tmp) / "audio.wav"
            _convert_to_wav(path, wav)
            data, rate = sf.read(str(wav), dtype="float32", always_2d=True)
    if data.size == 0:
        raise AudioError(f"{path.name}: nessun audio")
    return resample(data.mean(axis=1), rate)
