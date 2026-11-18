"""The two piano models: where to download them and how to check them.

Both come from unblend's ONNX exports (github.com/Ryan5453/unblend, code MIT),
pinned to one immutable Hugging Face revision, with size and SHA-256.
- fast:    HTDemucs 6 stems (Défossez / Meta). The weights carry no explicit
           licence grant; the code is MIT.
- quality: BS-RoFormer SW (jarredou), 6 stems. Weights CC-BY-NC-SA-4.0:
           personal, non-commercial use only.
"""

from __future__ import annotations

from dataclasses import dataclass

REVISION = "30b749fd691312b1e4b3f8fe79df0b51cde836cd"
BASE = f"https://huggingface.co/Ryan5453/unblend/resolve/{REVISION}"


@dataclass(frozen=True)
class SeparationModel:
    id: str
    name: str
    file: str
    size: int
    sha256: str
    licence: str

    @property
    def url(self) -> str:
        return f"{BASE}/{self.file}"


MODELS: dict[str, SeparationModel] = {
    "fast": SeparationModel(
        id="fast",
        name="Veloce (HTDemucs 6 stem)",
        file="htdemucs_6s_fp16.onnx",
        size=55845005,
        sha256="8cde625ece6fddb022a1a021cc1f2bef65a16711c20710e0e96e317f38fe994c",
        licence="Demucs (Meta): codice MIT, pesi senza licenza esplicita",
    ),
    "quality": SeparationModel(
        id="quality",
        name="Qualità (BS-RoFormer SW)",
        # The fp16 file: half the download, same result and speed on a CPU as fp32.
        file="bs_roformer_sw_fp16.onnx",
        size=351215164,
        sha256="560ef7646b40c0ed4ae958caacba4fcdc17f08649f8fd56034e5895a7e26ecae",
        licence="BS-RoFormer SW (jarredou): CC-BY-NC-SA-4.0, solo uso non commerciale",
    ),
}
