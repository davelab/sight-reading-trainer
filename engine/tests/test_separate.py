"""Piano separation. The real models (56 and 351 MB) are not needed here: a fake
graph that returns its input as the piano checks that the STFT framing, the
segments and their cross-fade rebuild the track exactly, for both families."""

import json
import threading
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from score_engine.separate import jobs as sep_jobs
from score_engine.separate.dsp import cut_back, istft, segments, stft, triangle, widened
from score_engine.separate.registry import MODELS
from score_engine.separate.runner import SAMPLE_RATE, Separator

FIXTURE = Path(__file__).parent / "fixtures" / "a440-mono-22k.wav"
SOURCES = ["drums", "bass", "other", "vocals", "guitar", "piano"]


class Meta:
    def __init__(self, data: dict[str, str]) -> None:
        self.custom_metadata_map = data


class IdentitySession:
    """Every stem is the input: the separated piano must equal the mix."""

    def __init__(self, family: str, branch: str = "spec") -> None:
        self.family = family
        self.branch = branch  # Demucs: which branch carries the input

    def get_modelmeta(self) -> Meta:
        common = {"sources": json.dumps(SOURCES), "sample_rate": "44100", "audio_channels": "2"}
        if self.family == "demucs":
            return Meta(
                common
                | {
                    "model_family": "demucs",
                    "segment_samples": "20000",
                    "stft_n_fft": "4096",
                    "stft_hop_length": "1024",
                    "stft_normalized": "true",
                    "stft_pad_samples": "1536",
                    "stft_frame_trim": "2",
                    "external_normalization": "true",
                }
            )
        return Meta(
            common
            | {
                "model_family": "roformer",
                "segment_samples": "16384",
                "stft_n_fft": "2048",
                "stft_hop_length": "512",
                "stft_normalized": "false",
                "external_normalization": "false",
            }
        )

    def run(self, names, feeds):
        stems = len(SOURCES)
        real = np.repeat(feeds["spec_real"][:, None], stems, axis=1)
        imag = np.repeat(feeds["spec_imag"][:, None], stems, axis=1)
        if self.family == "demucs":
            wave = np.repeat(feeds["audio"][:, None], stems, axis=1)
            if self.branch == "spec":
                return [real, imag, wave * 0]
            return [real * 0, imag * 0, wave]
        return [real, imag]


def fake_separator(family: str, branch: str = "spec") -> Separator:
    session = IdentitySession(family, branch)
    separator = Separator.__new__(Separator)
    separator.session = session  # type: ignore[assignment]
    meta = session.get_modelmeta().custom_metadata_map
    separator.family = family
    separator.stem = SOURCES.index("piano")
    separator.length = int(meta["segment_samples"])
    separator.n_fft = int(meta["stft_n_fft"])
    separator.hop = int(meta["stft_hop_length"])
    separator.normalized = meta["stft_normalized"] == "true"
    separator.pad = int(meta.get("stft_pad_samples", "0"))
    separator.trim = int(meta.get("stft_frame_trim", "0"))
    separator.normalize = meta.get("external_normalization") == "true"
    return separator


def song(samples: int) -> np.ndarray:
    rng = np.random.default_rng(3)
    t = np.arange(samples) / SAMPLE_RATE
    left = 0.4 * np.sin(2 * np.pi * 220 * t) + 0.05 * rng.standard_normal(samples)
    right = 0.3 * np.sin(2 * np.pi * 330 * t + 1) + 0.05 * rng.standard_normal(samples) + 0.02
    return np.stack([left, right]).astype(np.float32)


@pytest.mark.parametrize(("n_fft", "hop", "normalized"), [(2048, 512, False), (4096, 1024, True)])
def test_stft_round_trip(n_fft, hop, normalized):
    x = song(30000)
    spec = stft(x, n_fft, hop, normalized)
    assert spec.shape == (2, n_fft // 2 + 1, 1 + 30000 // hop)
    assert np.abs(istft(spec, n_fft, hop, normalized, 30000) - x).max() < 1e-5


def test_stft_matches_torch_conventions():
    """A sine on a bin: unnormalised peak = n_fft/4 (periodic Hann); normalised
    divides by sqrt(n_fft)."""
    n_fft, hop = 2048, 512
    t = np.arange(8192)
    x = np.stack([np.cos(2 * np.pi * 64 * t / n_fft)] * 2).astype(np.float32)
    plain = np.abs(stft(x, n_fft, hop, False)[0, :, 5])
    assert plain.argmax() == 64
    assert plain[64] == pytest.approx(n_fft / 4, rel=1e-3)
    normed = np.abs(stft(x, n_fft, hop, True)[0, :, 5])
    assert normed[64] == pytest.approx(n_fft / 4 / np.sqrt(n_fft), rel=1e-3)


def test_segments_and_cross_fade():
    assert segments(100, 40) == [(0, 40), (30, 40), (60, 40), (90, 10)]
    w = triangle(8)
    assert w.max() == 1 and w[0] == w[-1] and w[0] > 0
    x = np.arange(20, dtype=np.float32)[None].repeat(2, axis=0)
    # A short last segment is widened around its centre: real audio before,
    # zeros after the end; its output is cut back to the segment.
    wide = widened(x, 16, 4, 10)
    assert wide.shape == (2, 10)
    assert list(wide[0]) == [13, 14, 15, 16, 17, 18, 19, 0, 0, 0]
    assert list(cut_back(wide, 4)[0]) == [16, 17, 18, 19]


def test_demucs_spectrogram_framing():
    """Demucs' own framing (reflect pre-padding, top bin and two frames per side
    dropped, then put back as zeros) rebuilds a segment away from its edges;
    at the edges the zeroed frames fade it, as in Demucs itself."""
    t = np.arange(20000) / SAMPLE_RATE  # no energy at Nyquist (the dropped bin)
    x = np.stack([0.4 * np.sin(2 * np.pi * 220 * t), 0.3 * np.cos(2 * np.pi * 330 * t)])
    x = x.astype(np.float32)
    y = fake_separator("demucs", "spec").segment(x)
    assert np.abs(y - x)[:, 4096:-4096].max() < 1e-4
    assert np.abs(y - x)[:, :500].max() > 0.01  # the faded edge


@pytest.mark.parametrize(("family", "branch"), [("demucs", "wave"), ("roformer", "spec")])
def test_identity_model_rebuilds_the_track(family, branch):
    """Segments, overlap, cross-fade and (Demucs) normalisation are lossless."""
    mix = song(70001)  # several segments and a short last one
    fractions: list[float] = []
    piano = fake_separator(family, branch).piano(mix, fractions.append)
    assert piano.shape == mix.shape
    assert np.abs(piano - mix).max() < 1e-4
    assert fractions[-1] == 1.0 and fractions == sorted(fractions)


def test_load_stereo_duplicates_mono_and_resamples():
    audio = sep_jobs.load_stereo(FIXTURE, SAMPLE_RATE)
    assert audio.shape == (2, SAMPLE_RATE // 2)
    assert np.array_equal(audio[0], audio[1])
    spectrum = np.abs(np.fft.rfft(audio[0]))
    assert spectrum.argmax() * SAMPLE_RATE / audio.shape[1] == pytest.approx(440, abs=3)


def test_models_report_install_state(tmp_path, monkeypatch):
    monkeypatch.setenv("SCORE_STUDIO_DATA_DIR", str(tmp_path))
    listed = {m.id: m for m in sep_jobs.list_models().models}
    assert set(listed) == {"fast", "quality"}
    assert not listed["fast"].installed
    (tmp_path / "models").mkdir()
    (tmp_path / "models" / MODELS["fast"].file).write_bytes(b"x")
    assert sep_jobs.list_models().models[0].installed


def test_separate_writes_piano_and_rest(tmp_path, monkeypatch):
    """The job writes the piano and the song minus the piano, both 44.1 kHz stereo."""
    model_file = tmp_path / "model.onnx"
    monkeypatch.setattr(sep_jobs, "download", lambda *_: model_file)
    import score_engine.separate.runner as runner

    class HalfPiano(Separator):
        def __init__(self, _path):
            pass

        def piano(self, mix, on_segment=lambda _: None):
            on_segment(1.0)
            return mix * 0.5

    monkeypatch.setattr(runner, "Separator", HalfPiano)
    stages: list[str] = []
    result = sep_jobs.separate(
        FIXTURE, "fast", tmp_path / "out", "job", lambda stage, _f: stages.append(stage)
    )
    piano, rate = sf.read(result.piano_path)
    rest, _ = sf.read(result.rest_path)
    assert rate == SAMPLE_RATE and piano.shape == (SAMPLE_RATE // 2, 2)
    assert np.abs(piano - rest).max() < 1e-4  # half and half
    assert Path(result.piano_path).name == "a440-mono-22k - piano.wav"
    assert Path(result.rest_path).name == "a440-mono-22k - senza piano.wav"
    assert stages[0] == "load" and stages[-1] == "write" and "separate" in stages


def test_cancel_stops_the_job(tmp_path, monkeypatch):
    model_file = tmp_path / "model.onnx"
    monkeypatch.setattr(sep_jobs, "download", lambda *_: model_file)
    import score_engine.separate.runner as runner

    started = threading.Event()

    class Slow(Separator):
        def __init__(self, _path):
            pass

        def piano(self, mix, on_segment=lambda _: None):
            started.set()
            for _ in range(200):
                on_segment(0.5)
                threading.Event().wait(0.01)
            return mix

    monkeypatch.setattr(runner, "Separator", Slow)
    events: list[tuple[str, dict]] = []
    done = threading.Event()

    def notify(method, params):
        events.append((method, params))
        if method != "separate.progress":
            done.set()

    jobs = sep_jobs.SeparateJobs(notify)
    job = jobs.start(FIXTURE, "fast", tmp_path)
    assert started.wait(5)
    assert jobs.cancel(job)
    assert done.wait(5)
    assert events[-1][0] == "separate.failed" and events[-1][1]["cancelled"]


def test_rejects_unknown_input(tmp_path):
    jobs = sep_jobs.SeparateJobs(lambda *_: None)
    with pytest.raises(ValueError):
        jobs.start(tmp_path / "x.pdf", "fast", tmp_path)
    with pytest.raises(ValueError):
        jobs.start(FIXTURE, "huge", tmp_path)
