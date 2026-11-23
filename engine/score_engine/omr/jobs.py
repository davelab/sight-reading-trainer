"""OMR jobs: run in a background thread, report through JSON-RPC notifications.

`omr.run` returns a job id at once; the job then sends
  omr.progress {jobId, stage, page, total}
and finally either
  omr.done   {jobId, musicxml, pages, previews, warnings}
or
  omr.failed {jobId, message, cancelled}.
"""

from __future__ import annotations

import logging
import os
import shutil
import tempfile
import threading
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

from ..io.correct import check
from ..models import OmrProgress, OmrResult, OmrWarning
from .base import OmrBackend, OmrUnavailable
from .beams import add_beams
from .render import PdfError, page_count, render_pages

log = logging.getLogger("score_engine.omr")

Notify = Callable[[str, dict[str, Any]], None]


class Cancelled(Exception):
    pass


def data_dir() -> Path:
    """Persistent folder for downloaded models (the app passes its own)."""
    env = os.environ.get("SCORE_STUDIO_DATA_DIR")
    if env:
        return Path(env)
    return Path.home() / ".local" / "share" / "score-studio"


def default_backend() -> OmrBackend:
    fixture = os.environ.get("SCORE_STUDIO_OMR_FIXTURE")
    if fixture:
        from .fixture_backend import FixtureBackend

        return FixtureBackend(Path(fixture))
    from .homr_backend import HomrBackend

    return HomrBackend(data_dir() / "homr-models")


class OmrJobs:
    def __init__(
        self, notify: Notify, backend_factory: Callable[[], OmrBackend] = default_backend
    ) -> None:
        self.notify = notify
        self.backend_factory = backend_factory
        self._cancel: dict[str, threading.Event] = {}
        self._lock = threading.Lock()

    def start(self, pdf: Path, pages: list[int] | None) -> str:
        total = page_count(pdf)  # fail fast (in the reply) on a broken file
        selected = pages or list(range(1, total + 1))
        bad = [p for p in selected if not 1 <= p <= total]
        if bad:
            raise PdfError(f"pagine inesistenti: {bad} (il PDF ne ha {total})")
        job_id = uuid.uuid4().hex[:12]
        cancel = threading.Event()
        with self._lock:
            self._cancel[job_id] = cancel
        thread = threading.Thread(
            target=self._run,
            args=(job_id, pdf, selected, cancel),
            name=f"omr-{job_id}",
            daemon=True,
        )
        thread.start()
        return job_id

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            event = self._cancel.get(job_id)
        if event:
            event.set()
        return event is not None

    def _progress(self, job_id: str, stage: str, page: int, total: int) -> None:
        payload = OmrProgress(jobId=job_id, stage=stage, page=page, total=total)  # type: ignore[arg-type]
        self.notify("omr.progress", payload.model_dump(by_alias=True))

    def _run(self, job_id: str, pdf: Path, pages: list[int], cancel: threading.Event) -> None:
        work = Path(tempfile.mkdtemp(prefix="score-studio-omr-"))
        try:
            result = self._recognize(job_id, pdf, pages, cancel, work)
            self.notify("omr.done", result.model_dump(by_alias=True, exclude_none=True))
        except Cancelled:
            self.notify(
                "omr.failed", {"jobId": job_id, "message": "Import annullato", "cancelled": True}
            )
        except Exception as e:  # report everything to the app
            log.exception("OMR job %s failed", job_id)
            self.notify("omr.failed", {"jobId": job_id, "message": str(e), "cancelled": False})
        finally:
            shutil.rmtree(work, ignore_errors=True)
            with self._lock:
                self._cancel.pop(job_id, None)

    def _recognize(
        self, job_id: str, pdf: Path, pages: list[int], cancel: threading.Event, work: Path
    ) -> OmrResult:
        total = len(pages)
        self._progress(job_id, "render", 0, total)
        images, previews = render_pages(pdf, pages, work)
        if cancel.is_set():
            raise Cancelled
        self._progress(job_id, "download", 0, total)
        backend = self.backend_factory()
        backend.prepare(lambda line: log.info(line))
        recognised: list[Path] = []
        warnings: list[OmrWarning] = []
        for i, image in enumerate(images, start=1):
            if cancel.is_set():
                raise Cancelled
            self._progress(job_id, "recognize", i, total)
            try:
                recognised.append(backend.recognize(image))
            except OmrUnavailable:
                raise
            except Exception as e:
                log.warning("page %s not recognised: %s", pages[i - 1], e)
                warnings.append(
                    OmrWarning(
                        measure=1,
                        kind="page",
                        message=f"Pagina {pages[i - 1]} non riconosciuta: {e}",
                    )
                )
        if not recognised:
            raise RuntimeError(
                "nessuna pagina riconosciuta: " + "; ".join(w.message for w in warnings)
            )
        self._progress(job_id, "merge", total, total)
        out = work / "score.musicxml"
        merged = backend.merge(recognised, out) if len(recognised) > 1 else recognised[0]
        musicxml = add_beams(merged.read_text(encoding="utf-8"))
        return OmrResult(
            jobId=job_id,
            musicxml=musicxml,
            pages=total,
            previews=previews,
            warnings=warnings + check(musicxml),
        )
