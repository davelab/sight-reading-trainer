import json
import threading
import time
from pathlib import Path

import pytest

from score_engine.omr.fixture_backend import FixtureBackend
from score_engine.omr.homr_backend import configure, model_paths
from score_engine.omr.jobs import OmrJobs
from score_engine.omr.render import PdfError, page_count, render_pages
from tests.conftest import overfill_measure_4

FIX = Path(__file__).parent / "fixtures"
PDF = FIX / "minuet-in-g.pdf"


def test_homr_models_live_in_the_data_dir(tmp_path):
    """homr must never read or download models inside its (temporary) package dir."""
    configure(tmp_path / "models")
    paths = model_paths()
    assert paths and all(Path(p).parent == tmp_path / "models" for p in paths), paths


def test_render_clean_pdf(tmp_path):
    assert page_count(PDF) == 1
    images, previews = render_pages(PDF, [1], tmp_path)
    from PIL import Image

    width, _ = Image.open(images[0]).size
    assert 2400 <= width <= 2600  # A4 at 300 DPI
    assert previews[0].startswith("data:image/jpeg;base64,")


def test_broken_pdf_is_rejected(tmp_path):
    bad = tmp_path / "bad.pdf"
    bad.write_text("not a pdf")
    with pytest.raises(PdfError):
        page_count(bad)


class Collector:
    def __init__(self) -> None:
        self.messages: list[tuple[str, dict]] = []
        self.done = threading.Event()

    def __call__(self, method: str, params: dict) -> None:
        self.messages.append((method, params))
        if method in ("omr.done", "omr.failed"):
            self.done.set()

    def wait(self) -> tuple[str, dict]:
        return self.wait_long(30)

    def wait_long(self, seconds: float) -> tuple[str, dict]:
        assert self.done.wait(seconds), self.messages
        return self.messages[-1]


def test_job_reports_progress_and_returns_correctable_musicxml(minuet_path):
    out = Collector()
    jobs = OmrJobs(out, lambda: FixtureBackend(minuet_path))
    job = jobs.start(PDF, None)
    method, result = out.wait()
    assert method == "omr.done"
    stages = [p["stage"] for m, p in out.messages if m == "omr.progress"]
    assert stages == ["render", "download", "recognize", "merge"]
    assert all(p["jobId"] == job for _, p in out.messages)
    assert result["pages"] == 1 and len(result["previews"]) == 1
    assert "<score-partwise" in result["musicxml"]
    assert result["warnings"] == []


def test_recognition_errors_become_warnings(minuet_path):
    out = Collector()
    OmrJobs(out, lambda: FixtureBackend(minuet_path, overfill_measure_4)).start(PDF, [1])
    method, result = out.wait()
    assert method == "omr.done"
    assert [w["measure"] for w in result["warnings"]] == [4]


class SlowBackend(FixtureBackend):
    def recognize(self, image):
        time.sleep(0.5)
        return super().recognize(image)


def test_cancel(minuet_path):
    out = Collector()
    jobs = OmrJobs(out, lambda: SlowBackend(minuet_path))
    job = jobs.start(PDF, None)
    while not any(p.get("stage") == "recognize" for _, p in out.messages):
        time.sleep(0.01)
    assert jobs.cancel(job)
    method, payload = out.wait()
    # The page in progress finishes; the job then stops before merging.
    assert method in ("omr.failed", "omr.done")
    if method == "omr.failed":
        assert payload["cancelled"] is True


class BrokenBackend(FixtureBackend):
    def recognize(self, image):
        raise RuntimeError("no staffs found")


def test_job_fails_when_no_page_is_recognised(minuet_path):
    out = Collector()
    OmrJobs(out, lambda: BrokenBackend(minuet_path)).start(PDF, None)
    method, payload = out.wait()
    assert method == "omr.failed" and not payload["cancelled"]
    assert "no staffs found" in payload["message"]


def test_bad_page_numbers_are_rejected_at_once(minuet_path):
    with pytest.raises(PdfError, match="pagine inesistenti"):
        OmrJobs(Collector(), lambda: FixtureBackend(minuet_path)).start(PDF, [2])


def test_rpc_flow_through_the_stdio_engine(minuet_path):
    """omr.run over JSON-RPC: a reply with the job id, then notifications on stdout."""
    import os
    import subprocess
    import sys

    env = dict(os.environ, SCORE_STUDIO_OMR_FIXTURE=str(minuet_path))
    proc = subprocess.Popen(
        [sys.executable, "-m", "score_engine"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        env=env,
    )
    req = {"jsonrpc": "2.0", "id": 1, "method": "omr.run", "params": {"pdfPath": str(PDF)}}
    proc.stdin.write(json.dumps(req) + "\n")
    proc.stdin.flush()
    lines = []
    deadline = time.time() + 60
    while time.time() < deadline:
        msg = json.loads(proc.stdout.readline())
        lines.append(msg)
        if msg.get("method") in ("omr.done", "omr.failed"):
            break
    proc.stdin.close()
    proc.wait(10)
    assert lines[0] == {"jsonrpc": "2.0", "id": 1, "result": {"jobId": lines[0]["result"]["jobId"]}}
    assert lines[-1]["method"] == "omr.done"
    assert {m.get("method") for m in lines[1:-1]} == {"omr.progress"}


def _models_present() -> bool:
    from score_engine.omr.jobs import data_dir

    return len(list((data_dir() / "homr-models").glob("*.onnx"))) >= 3


def _notes(musicxml: str):
    import xml.etree.ElementTree as ET
    from collections import Counter

    from score_engine.io.xml_walk import walk

    notes, _ = walk(ET.fromstring(musicxml.encode("utf-8")))
    return Counter(
        (n.ref.measure, n.ref.staff, n.ref.offset, n.ref.midi, n.duration)
        for n in notes
        if n.ref.midi is not None
    )


@pytest.mark.skipif(
    not _models_present(),
    reason="homr models not downloaded: run once with network, "
    "e.g. SCORE_STUDIO_DATA_DIR=... and an omr.run, or the app's PDF import",
)
def test_m5_exit_criterion_clean_pdf_becomes_correctable_musicxml(minuet_path):
    """M5 exit: a clean PDF becomes MusicXML that can be corrected to the original.

    Measured at commit time with homr 0.7.1 on CPU (11.6 s): 186 of 191 notes
    exact (measure, staff, onset, pitch, duration); the 5 others are C#s read
    as C (measures 20-23). Five "sharp" corrections restore the original.
    """
    from fractions import Fraction

    from score_engine.io.correct import apply_edit, check
    from score_engine.io.xml_walk import NoteRef

    out = Collector()
    OmrJobs(out).start(PDF, None)
    method, result = out.wait_long(900)
    assert method == "omr.done", result
    original, recognised = _notes(minuet_path.read_text()), _notes(result["musicxml"])
    exact = sum((original & recognised).values())
    assert exact / sum(original.values()) >= 0.95, (original - recognised, recognised - original)
    assert check(result["musicxml"]) == []

    # Correct every remaining difference that is a missing sharp, as a user would.
    xml = result["musicxml"]
    for measure, staff, offset, midi, _ in sorted((recognised - original).elements()):
        if (measure, staff, offset, midi + 1) in {k[:4] for k in original}:
            xml = apply_edit(xml, NoteRef(measure, staff, Fraction(offset), midi), "sharp")
    assert _notes(xml) == original
