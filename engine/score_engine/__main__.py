"""Sidecar entry point: JSON-RPC 2.0 loop on stdin/stdout.

stdout carries protocol messages ONLY. Every log line goes to stderr.
"""

from __future__ import annotations

import logging
import sys

from .methods import dispatcher


def main() -> None:
    logging.basicConfig(
        stream=sys.stderr, level=logging.INFO, format="[engine] %(levelname)s %(name)s: %(message)s"
    )
    # Line-buffered, UTF-8, LF only: one message per line.
    sys.stdout.reconfigure(encoding="utf-8", newline="\n", line_buffering=True)
    sys.stdin.reconfigure(encoding="utf-8")
    logging.getLogger("score_engine").info("ready")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        response = dispatcher.handle_line(line)
        if response is not None:
            sys.stdout.write(response + "\n")


if __name__ == "__main__":
    main()
