"""Run a separation graph over a whole track and keep the piano stem.

Follows unblend's ONNX contract (onnx.md, "Shared contract" and "Full tracks"):
the track is cut into the graph's segment length with 25% overlap, each
segment's output is weighted by a triangle and the overlaps are averaged.
Only the piano stem is kept, so memory stays at two stereo tracks.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from math import ceil
from pathlib import Path

import numpy as np

from .dsp import cut_back, istft, segments, stft, triangle, widened

SAMPLE_RATE = 44100
STEM = "piano"


class Separator:
    def __init__(self, model: Path) -> None:
        import onnxruntime as ort

        options = ort.SessionOptions()
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.session = ort.InferenceSession(str(model), options, providers=["CPUExecutionProvider"])
        meta = self.session.get_modelmeta().custom_metadata_map
        self.family = meta["model_family"]
        if self.family not in ("demucs", "roformer"):
            raise ValueError(f"modello non supportato: {self.family}")
        if int(meta["sample_rate"]) != SAMPLE_RATE or int(meta["audio_channels"]) != 2:
            raise ValueError("il modello non lavora a 44,1 kHz stereo")
        sources = json.loads(meta["sources"])
        if STEM not in sources:
            raise ValueError("il modello non separa il pianoforte")
        self.stem = sources.index(STEM)
        self.length = int(meta["segment_samples"])
        self.n_fft = int(meta["stft_n_fft"])
        self.hop = int(meta["stft_hop_length"])
        self.normalized = meta["stft_normalized"] == "true"
        self.pad = int(meta.get("stft_pad_samples", "0"))
        self.trim = int(meta.get("stft_frame_trim", "0"))
        self.normalize = meta.get("external_normalization") == "true"

    def segment(self, x: np.ndarray) -> np.ndarray:
        """One segment (2, length) -> its piano stem (2, length)."""
        if self.family == "demucs":
            return self._demucs(x)
        spec = stft(x, self.n_fft, self.hop, self.normalized)[None]
        real, imag = self.session.run(
            ["out_spec_real", "out_spec_imag"],
            {"spec_real": spec.real.copy(), "spec_imag": spec.imag.copy()},
        )
        out = real[0, self.stem] + 1j * imag[0, self.stem]
        return istft(out, self.n_fft, self.hop, self.normalized, x.shape[-1])

    def _demucs(self, x: np.ndarray) -> np.ndarray:
        n = x.shape[-1]
        frames = ceil(n / self.hop)
        right = self.pad + frames * self.hop - n
        padded = np.pad(x, ((0, 0), (self.pad, right)), mode="reflect")
        spec = stft(padded, self.n_fft, self.hop, self.normalized)
        spec = spec[:, :-1, self.trim : self.trim + frames][None]
        real, imag, wave = self.session.run(
            ["out_spec_real", "out_spec_imag", "out_wave"],
            {
                "spec_real": spec.real.copy(),
                "spec_imag": spec.imag.copy(),
                "audio": x[None].astype(np.float32),
            },
        )
        z = real[0, self.stem] + 1j * imag[0, self.stem]
        z = np.pad(z, ((0, 0), (0, 1), (2, 2)))
        y = istft(z, self.n_fft, self.hop, self.normalized, frames * self.hop + 2 * self.pad)
        return y[:, self.pad : self.pad + n] + wave[0, self.stem]

    def piano(
        self, mix: np.ndarray, on_segment: Callable[[float], None] = lambda _: None
    ) -> np.ndarray:
        """Stereo mix (2, samples) at 44.1 kHz -> the piano (2, samples)."""
        x = mix.astype(np.float32)
        mean = std = 0.0
        if self.normalize:
            ref = x.mean(axis=0)
            mean, std = float(ref.mean()), float(ref.std(ddof=1))
            x = (x - mean) / (1e-5 + std)
        total = x.shape[-1]
        out = np.zeros_like(x)
        weight_sum = np.zeros(total, dtype=np.float32)
        weight = triangle(self.length)
        plan = segments(total, self.length)
        for i, (offset, valid) in enumerate(plan):
            y = cut_back(self.segment(widened(x, offset, valid, self.length)), valid)
            out[:, offset : offset + valid] += y * weight[:valid]
            weight_sum[offset : offset + valid] += weight[:valid]
            on_segment((i + 1) / len(plan))
        out /= np.maximum(weight_sum, 1e-8)
        if self.normalize:
            out = out * std + mean
        return out
