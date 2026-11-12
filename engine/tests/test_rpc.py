import json
import subprocess
import sys
import zipfile

from score_engine import __version__
from score_engine.methods import dispatcher
from score_engine.rpc import INVALID_PARAMS, METHOD_NOT_FOUND, NOT_IMPLEMENTED, PARSE_ERROR


def call(method, params=None, req_id=1):
    req = {"jsonrpc": "2.0", "id": req_id, "method": method}
    if params is not None:
        req["params"] = params
    return json.loads(dispatcher.handle_line(json.dumps(req)))


def test_ping():
    assert call("ping") == {"jsonrpc": "2.0", "id": 1, "result": {"version": __version__}}


def test_unknown_method():
    assert call("nope")["error"]["code"] == METHOD_NOT_FOUND


def test_parse_error():
    assert json.loads(dispatcher.handle_line("{not json"))["error"]["code"] == PARSE_ERROR


def test_notification_has_no_response():
    assert dispatcher.handle_line('{"jsonrpc":"2.0","method":"ping"}') is None


def test_planned_methods_report_not_implemented():
    assert call("omr.run", {"pdfPath": "x.pdf"})["error"]["code"] == NOT_IMPLEMENTED


def test_analyze_returns_the_analysis_schema(minuet_path):
    result = call("analyze", {"musicxml": minuet_path.read_text()})["result"]
    assert result["schemaVersion"] == 1
    assert result["key"][0]["tonic"] == "G"
    first = result["chords"][0]
    assert set(first) >= {"measure", "beat", "offset", "symbol", "roman", "function"}


def test_analyze_rejects_bad_input():
    assert call("analyze", {})["error"]["code"] == INVALID_PARAMS
    assert "error" in call("analyze", {"musicxml": "<not-a-score/>"})


def test_normalize_minuet(minuet_path):
    result = call("score.normalize", {"path": str(minuet_path)})["result"]
    assert result["measures"] == 32
    assert result["parts"] == [{"id": "P1", "name": "Piano", "staves": 2}]
    assert result["musicxml"].lstrip().startswith("<?xml")


def test_normalize_mxl(minuet_path, tmp_path):
    mxl = tmp_path / "minuet.mxl"
    with zipfile.ZipFile(mxl, "w") as zf:
        zf.writestr(
            "META-INF/container.xml",
            '<container><rootfiles><rootfile full-path="score/minuet.musicxml"/>'
            "</rootfiles></container>",
        )
        zf.write(minuet_path, "score/minuet.musicxml")
    assert call("score.normalize", {"path": str(mxl)})["result"]["measures"] == 32


def test_stdio_loop_keeps_stdout_clean():
    """stdout must carry only protocol lines; logs go to stderr."""
    proc = subprocess.run(
        [sys.executable, "-m", "score_engine"],
        input='{"jsonrpc":"2.0","id":7,"method":"ping"}\n\n{"jsonrpc":"2.0","id":8,"method":"x"}\n',
        capture_output=True,
        text=True,
        timeout=30,
        check=True,
    )
    lines = proc.stdout.splitlines()
    assert [json.loads(line)["id"] for line in lines] == [7, 8]
    assert "ready" in proc.stderr
