"""Development backend: "recognises" every page as a given MusicXML file.

Enabled with SCORE_STUDIO_OMR_FIXTURE=/path/to/score.musicxml, to exercise
the import and review flow without homr's models (e.g. in CI or offline).
"""

from __future__ import annotations

import shutil
from collections.abc import Callable
from pathlib import Path


class FixtureBackend:
    name = "fixture"

    def __init__(self, musicxml: Path, alter: Callable[[str], str] | None = None) -> None:
        self.musicxml = musicxml
        self.alter = alter

    def prepare(self, report: Callable[[str], None]) -> None:
        report("Backend di prova: nessun modello da scaricare")

    def recognize(self, image: Path) -> Path:
        out = image.with_suffix(".musicxml")
        text = self.musicxml.read_text(encoding="utf-8")
        out.write_text(self.alter(text) if self.alter else text, encoding="utf-8")
        return out

    def merge(self, pages: list[Path], out: Path) -> Path:
        shutil.copyfile(pages[0], out)
        return out
