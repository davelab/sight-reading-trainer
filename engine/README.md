# score-engine

Python sidecar for Score Studio. Speaks JSON-RPC 2.0 on stdin/stdout, one JSON
object per line. Logs go to stderr only. Knows nothing about audio or UI.

```sh
uv run pytest                 # tests
uv run ruff check             # lint
echo '{"jsonrpc":"2.0","id":1,"method":"ping"}' | uv run python -m score_engine
```

Methods (see `docs/SPEC.md`, "Contratti dati e IPC"):

| Method | Status |
|---|---|
| `ping` | implemented |
| `score.normalize` | implemented (parse, measure count, parts; `.mxl` supported) |
| `analyze` | M3/M4 — returns JSON-RPC error `-32001` for now |
| `omr.run` | M5 — returns JSON-RPC error `-32001` for now |
