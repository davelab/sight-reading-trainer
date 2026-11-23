"""Minimal JSON-RPC 2.0 dispatcher: one JSON object per line."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from typing import Any

from pydantic import BaseModel

log = logging.getLogger("score_engine.rpc")

PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603
NOT_IMPLEMENTED = -32001  # application error: method planned for a later milestone


class RpcError(Exception):
    def __init__(self, code: int, message: str, data: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data


Handler = Callable[[dict[str, Any]], Any]


class Dispatcher:
    def __init__(self) -> None:
        self._methods: dict[str, Handler] = {}

    def method(self, name: str) -> Callable[[Handler], Handler]:
        def register(fn: Handler) -> Handler:
            self._methods[name] = fn
            return fn

        return register

    def handle_line(self, line: str) -> str | None:
        """Handle one request line; return the response line (None for notifications)."""
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            return _error(None, PARSE_ERROR, f"Parse error: {e.msg}")
        if not isinstance(req, dict) or req.get("jsonrpc") != "2.0" or "method" not in req:
            return _error(
                req.get("id") if isinstance(req, dict) else None, INVALID_REQUEST, "Invalid request"
            )
        req_id = req.get("id")
        is_notification = "id" not in req
        params = req.get("params") or {}
        if not isinstance(params, dict):
            return _error(req_id, INVALID_PARAMS, "params must be an object")
        fn = self._methods.get(req["method"])
        if fn is None:
            return (
                None
                if is_notification
                else _error(req_id, METHOD_NOT_FOUND, f"Method not found: {req['method']}")
            )
        try:
            result = fn(params)
        except RpcError as e:
            return None if is_notification else _error(req_id, e.code, e.message, e.data)
        except Exception as e:  # noqa: BLE001 — report every failure to the caller
            log.exception("method %s failed", req["method"])
            return None if is_notification else _error(req_id, INTERNAL_ERROR, str(e))
        if is_notification:
            return None
        if isinstance(result, BaseModel):
            result = result.model_dump(by_alias=True, exclude_none=True)
        return json.dumps(
            {"jsonrpc": "2.0", "id": req_id, "result": result},
            ensure_ascii=False,
            separators=(",", ":"),
        )


def _error(req_id: Any, code: int, message: str, data: Any = None) -> str:
    err: dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        err["data"] = data
    return json.dumps(
        {"jsonrpc": "2.0", "id": req_id, "error": err}, ensure_ascii=False, separators=(",", ":")
    )
