"""OMR backend interface. The only real backend is homr (AGPL-3.0, see SPEC:
the bundled app is subject to the AGPL). Backends run inside the `omr`
sidecar, never in the analysis engine."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Protocol


class OmrBackend(Protocol):
    name: str

    def prepare(self, report: Callable[[str], None]) -> None:
        """Make the models available (download them once); `report` takes a status line."""

    def recognize(self, image: Path) -> Path:
        """Recognise one page image, return the path of the MusicXML written."""

    def merge(self, pages: list[Path], out: Path) -> Path:
        """Join the per-page MusicXML files into one score."""


class OmrUnavailable(RuntimeError):
    pass
