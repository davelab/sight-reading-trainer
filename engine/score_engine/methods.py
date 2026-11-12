"""JSON-RPC methods exposed by the engine."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from . import __version__, analysis
from .io import musicxml
from .io import musicxml as musicxml_io
from .models import Analysis, NormalizeResult, PingResult
from .rpc import INVALID_PARAMS, NOT_IMPLEMENTED, Dispatcher, RpcError

dispatcher = Dispatcher()


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


@dispatcher.method("omr.run")
def omr_run(_params: dict[str, Any]) -> None:
    raise RpcError(NOT_IMPLEMENTED, "omr.run is planned for milestone M5")
