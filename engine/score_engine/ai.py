"""Calls to Claude (Anthropic API) for the features that use it on request:
the second reading of OMR measures and the composition assistant.

The API key comes from the app with each request (macOS Keychain) and is never
stored or logged here. Answers are JSON constrained by a schema (structured
outputs); a refusal falls back server-side to another model.
"""

from __future__ import annotations

import json
import logging
from typing import Any

log = logging.getLogger("score_engine.ai")

MODEL = "claude-opus-5-5"


class AIError(RuntimeError):
    """A failure to show the user as it is (in Italian)."""


def call_claude(
    api_key: str,
    system: str,
    content: list[dict[str, Any]],
    schema: dict[str, Any],
    purpose: str,
    effort: str = "high",
    max_tokens: int = 32000,
) -> dict:
    """One request; returns the JSON answer as a dict."""
    import anthropic

    client = anthropic.Anthropic(api_key=api_key, timeout=600.0)
    try:
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": content}],
            output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.AuthenticationError as e:
        raise AIError("chiave API di Claude non valida") from e
    except anthropic.PermissionDeniedError as e:
        raise AIError("la chiave API non ha accesso a questo modello") from e
    except anthropic.RateLimitError as e:
        raise AIError("troppe richieste a Claude: riprova tra un minuto") from e
    except anthropic.APIConnectionError as e:
        raise AIError("Claude non raggiungibile: controlla la connessione") from e
    except anthropic.APIStatusError as e:
        raise AIError(f"errore di Claude ({e.status_code}): {e.message}") from e
    if response.stop_reason == "refusal":
        raise AIError("Claude ha rifiutato la richiesta")
    if response.stop_reason == "max_tokens":
        raise AIError("risposta di Claude troppo lunga: chiedi meno battute")
    text = next((b.text for b in response.content if b.type == "text"), "")
    log.info("%s request %s: %s", purpose, response._request_id, response.usage)
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise AIError("risposta di Claude non leggibile") from e
