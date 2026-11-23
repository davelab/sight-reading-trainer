"""STFT, inverse STFT and segment cross-fading, in NumPy.

The ONNX graphs are the networks alone: the STFT before them and the inverse
after them must match `torch.stft` / `torch.istft` exactly (centred, reflect
padding, periodic Hann window), as unblend's export notes describe.
"""

from __future__ import annotations

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view


def hann(n: int) -> np.ndarray:
    """Periodic Hann window (torch.hann_window's default)."""
    return (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n) / n)).astype(np.float32)


def stft(x: np.ndarray, n_fft: int, hop: int, normalized: bool) -> np.ndarray:
    """(channels, samples) -> complex (channels, n_fft // 2 + 1, frames), centred."""
    half = n_fft // 2
    padded = np.pad(x, ((0, 0), (half, half)), mode="reflect")
    frames = sliding_window_view(padded, n_fft, axis=-1)[:, ::hop, :] * hann(n_fft)
    spec = np.fft.rfft(frames, axis=-1).transpose(0, 2, 1)
    if normalized:
        spec = spec / np.sqrt(n_fft)
    return spec.astype(np.complex64)


def istft(spec: np.ndarray, n_fft: int, hop: int, normalized: bool, length: int) -> np.ndarray:
    """Complex (channels, bins, frames) -> (channels, length), like torch.istft(center=True)."""
    channels, _, count = spec.shape
    window = hann(n_fft)
    frames = np.fft.irfft(spec.transpose(0, 2, 1), n=n_fft, axis=-1).astype(np.float32)
    if normalized:
        frames *= np.sqrt(n_fft)
    frames *= window
    total = n_fft + hop * (count - 1)
    out = np.zeros((channels, total), dtype=np.float32)
    norm = np.zeros(total, dtype=np.float32)
    square = window * window
    for t in range(count):
        out[:, t * hop : t * hop + n_fft] += frames[:, t]
        norm[t * hop : t * hop + n_fft] += square
    half = n_fft // 2
    out = out[:, half : half + length]
    norm = norm[half : half + length]
    out = out / np.where(norm > 1e-11, norm, 1.0)
    if out.shape[1] < length:
        out = np.pad(out, ((0, 0), (0, length - out.shape[1])))
    return out


def triangle(length: int) -> np.ndarray:
    """Cross-fade weight of one segment: 1..L/2 rising, then falling to 1, max 1."""
    half = length // 2
    w = np.concatenate([np.arange(1, half + 1), np.arange(length - half, 0, -1)]).astype(np.float64)
    return (w / w.max()).astype(np.float32)


def segments(total: int, length: int, overlap: float = 0.25) -> list[tuple[int, int]]:
    """(offset, valid length) of each segment over a track of `total` samples."""
    stride = max(1, int((1 - overlap) * length))
    return [(o, min(length, total - o)) for o in range(0, total, stride)]


def widened(x: np.ndarray, offset: int, valid: int, length: int) -> np.ndarray:
    """The segment widened to `length` around its centre (real audio before it,
    zeros past either end of the track)."""
    delta = length - valid
    start = offset - delta // 2
    end = start + length
    lo, hi = max(0, start), min(x.shape[-1], end)
    out = x[:, lo:hi]
    if lo - start or end - hi:
        out = np.pad(out, ((0, 0), (lo - start, end - hi)))
    return out


def cut_back(y: np.ndarray, valid: int) -> np.ndarray:
    """A widened segment's output cut back to the segment itself."""
    delta = y.shape[-1] - valid
    return y[:, delta // 2 : delta // 2 + valid]
