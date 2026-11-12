"""homr (https://github.com/liebharc/homr, AGPL-3.0) as the OMR backend.

homr keeps its ONNX models inside its own package directory, which in the
bundled app is a temporary folder unpacked at every start. `configure` moves
them to a persistent folder (the app's data directory), so they are
downloaded once. This patches homr internals: the version is pinned in
pyproject.toml and tests/test_omr.py checks every path homr uses.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from pathlib import Path

from .base import OmrUnavailable

_configured: Path | None = None


def configure(model_dir: Path) -> None:
    """Point every homr model path to `model_dir` (idempotent)."""
    global _configured
    if _configured == model_dir:
        return
    model_dir.mkdir(parents=True, exist_ok=True)
    import homr.main as hmain
    import homr.segmentation.config as segconfig
    import homr.segmentation.inference_segnet as segnet
    import homr.transformer.configs as tconfigs

    for module in (segconfig, segnet, hmain):
        for name in ("segnet_path_onnx", "segnet_path_onnx_fp16"):
            if hasattr(module, name):
                setattr(module, name, str(model_dir / os.path.basename(getattr(module, name))))

    original_init = getattr(
        tconfigs.FilePaths, "_score_studio_original_init", tconfigs.FilePaths.__init__
    )

    def init(self: tconfigs.FilePaths) -> None:
        original_init(self)
        for attr in ("encoder_path", "decoder_path", "encoder_path_fp16", "decoder_path_fp16"):
            setattr(self, attr, str(model_dir / os.path.basename(getattr(self, attr))))

    init._score_studio_original_init = original_init  # type: ignore[attr-defined]
    tconfigs.FilePaths._score_studio_original_init = original_init  # type: ignore[attr-defined]
    tconfigs.FilePaths.__init__ = init  # type: ignore[method-assign]
    tconfigs.default_config = tconfigs.Config()
    hmain.default_config = tconfigs.default_config
    _configured = model_dir


def model_paths() -> list[str]:
    """Every model path homr will use now (for the tests)."""
    import homr.main as hmain
    import homr.segmentation.config as segconfig
    import homr.segmentation.inference_segnet as segnet
    import homr.transformer.configs as tconfigs

    fp = tconfigs.Config().filepaths
    return [
        segconfig.segnet_path_onnx,
        segconfig.segnet_path_onnx_fp16,
        segnet.segnet_path_onnx,
        hmain.segnet_path_onnx,
        hmain.default_config.filepaths.encoder_path,
        fp.encoder_path,
        fp.decoder_path,
        fp.encoder_path_fp16,
        fp.decoder_path_fp16,
    ]


class HomrBackend:
    name = "homr"

    def __init__(self, model_dir: Path) -> None:
        try:
            configure(model_dir)
            import homr.main as hmain
            from homr.onnx_providers import coreml_available, cuda_available, rocm_available
        except ImportError as e:  # pragma: no cover - the analysis-only build has no homr
            raise OmrUnavailable(f"homr non disponibile in questo motore: {e}") from e
        self._main = hmain
        gpu = cuda_available() or rocm_available()
        # As homr's own "auto" mode: CoreML helps the segmentation net on Macs.
        self._transformer_gpu = gpu
        self._segnet_gpu = gpu or coreml_available()

    def prepare(self, report: Callable[[str], None]) -> None:
        report("Controllo dei modelli homr (al primo uso si scaricano, alcune centinaia di MB)")
        try:
            self._main.download_weights(self._segnet_gpu, self._transformer_gpu, False)
        except Exception as e:
            raise OmrUnavailable(f"impossibile scaricare i modelli di homr: {e}") from e

    def recognize(self, image: Path) -> Path:
        config = self._main.ProcessingConfig(
            enable_debug=False,
            enable_cache=False,
            write_staff_positions=False,
            read_staff_positions=False,
            selected_staff=-1,
            transformer_use_gpu=self._transformer_gpu,
            segnet_use_gpu=self._segnet_gpu,
            coreml_encoder=False,
            title_detection=False,  # would need another OCR model download
        )
        from homr.music_xml_generator import XmlGeneratorArguments

        return Path(self._main.process_image(str(image), config, XmlGeneratorArguments()))

    def merge(self, pages: list[Path], out: Path) -> Path:
        # Not homr's relieur: it loses <divisions> across pages (see omr/merge.py).
        from .merge import merge_files

        return merge_files(pages, out)
