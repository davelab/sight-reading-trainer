"""JSON-RPC methods exposed by the engine."""

from __future__ import annotations

import json
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any, get_args

from . import __version__, analysis
from .io import correct, musicxml
from .io import musicxml as musicxml_io
from .models import Analysis, CheckResult, EditAction, NormalizeResult, NoteRef, PingResult
from .rpc import INVALID_PARAMS, Dispatcher, RpcError

dispatcher = Dispatcher()

# Notifications (JSON-RPC messages without id) sent by background jobs. The
# stdio loop installs a writer; until then they are dropped.
_notify_lock = threading.Lock()
_writer: Callable[[str], None] | None = None


def set_writer(writer: Callable[[str], None]) -> None:
    global _writer
    _writer = writer


def notify(method: str, params: dict[str, Any]) -> None:
    line = json.dumps(
        {"jsonrpc": "2.0", "method": method, "params": params},
        ensure_ascii=False,
        separators=(",", ":"),
    )
    with _notify_lock:
        if _writer is not None:
            _writer(line)


_jobs = None


def jobs():
    """The OMR job runner, created on first use (imports nothing heavy before)."""
    global _jobs
    if _jobs is None:
        from .omr.jobs import OmrJobs

        _jobs = OmrJobs(notify)
    return _jobs


def _require_str(params: dict[str, Any], key: str) -> str:
    value = params.get(key)
    if not isinstance(value, str) or not value:
        raise RpcError(INVALID_PARAMS, f"missing string parameter '{key}'")
    return value


@dispatcher.method("ping")
def ping(_params: dict[str, Any]) -> PingResult:
    return PingResult(version=__version__)


@dispatcher.method("score.normalize")
def score_normalize(params: dict[str, Any]) -> NormalizeResult:
    path = Path(_require_str(params, "path"))
    if not path.is_file():
        raise RpcError(INVALID_PARAMS, f"file not found: {path}")
    return musicxml.normalize(path)


@dispatcher.method("analyze")
def analyze(params: dict[str, Any]) -> Analysis:
    musicxml = _require_str(params, "musicxml")
    try:
        return analysis.analyze(musicxml)
    except musicxml_io.MusicXmlError as e:
        raise RpcError(INVALID_PARAMS, str(e)) from e


@dispatcher.method("score.check")
def score_check(params: dict[str, Any]) -> CheckResult:
    """Likely recognition errors (measures that do not add up)."""
    musicxml = _require_str(params, "musicxml")
    try:
        return CheckResult(musicxml=musicxml, warnings=correct.check(musicxml))
    except correct.EditError as e:
        raise RpcError(INVALID_PARAMS, str(e)) from e


@dispatcher.method("score.edit")
def score_edit(params: dict[str, Any]) -> CheckResult:
    """Correct one note, found by position; returns the new MusicXML and its warnings."""
    musicxml = _require_str(params, "musicxml")
    action = params.get("action")
    if action not in get_args(EditAction):
        raise RpcError(INVALID_PARAMS, f"unknown action: {action!r}")
    try:
        ref = NoteRef.model_validate(params.get("note"))
    except ValueError as e:
        raise RpcError(INVALID_PARAMS, f"invalid note: {e}") from e
    from fractions import Fraction

    from .io.xml_walk import NoteRef as Ref

    value = params.get("value")
    if value is not None and not isinstance(value, str):
        raise RpcError(INVALID_PARAMS, "value must be a string")
    try:
        edited, moved = correct.edit(
            musicxml,
            Ref(ref.measure, ref.staff, Fraction(ref.offset).limit_denominator(96), ref.pitch),
            action,
            value,
        )
        note = (
            NoteRef(
                measure=moved.measure,
                staff=moved.staff,
                offset=float(moved.offset),
                pitch=moved.midi,
            )
            if moved is not None and moved.midi is not None
            else None
        )
        return CheckResult(musicxml=edited, warnings=correct.check(edited), note=note)
    except correct.EditError as e:
        raise RpcError(INVALID_PARAMS, str(e)) from e


@dispatcher.method("omr.run")
def omr_run(params: dict[str, Any]) -> dict[str, str]:
    """Start recognising a PDF in the background; progress arrives as notifications."""
    path = Path(_require_str(params, "pdfPath"))
    if not path.is_file():
        raise RpcError(INVALID_PARAMS, f"file not found: {path}")
    pages = params.get("pages")
    if pages is not None and not (
        isinstance(pages, list) and all(isinstance(p, int) for p in pages)
    ):
        raise RpcError(INVALID_PARAMS, "pages must be a list of page numbers")
    from .omr.render import PdfError

    try:
        return {"jobId": jobs().start(path, pages)}
    except PdfError as e:
        raise RpcError(INVALID_PARAMS, str(e)) from e


@dispatcher.method("omr.cancel")
def omr_cancel(params: dict[str, Any]) -> dict[str, bool]:
    return {"cancelled": jobs().cancel(_require_str(params, "jobId"))}
