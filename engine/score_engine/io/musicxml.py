"""MusicXML parsing and normalisation (``.musicxml``, ``.xml`` and compressed ``.mxl``)."""

from __future__ import annotations

import posixpath
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from ..models import NormalizeResult, PartInfo


class MusicXmlError(ValueError):
    pass


def read_musicxml(path: Path) -> str:
    """Return the MusicXML text of ``path``, unpacking ``.mxl`` archives."""
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as zf:
            return zf.read(_mxl_rootfile(zf)).decode("utf-8")
    return path.read_text(encoding="utf-8")


def _mxl_rootfile(zf: zipfile.ZipFile) -> str:
    try:
        container = ET.fromstring(zf.read("META-INF/container.xml"))
        for el in container.iter():
            if el.tag.endswith("rootfile") and el.get("full-path"):
                return posixpath.normpath(el.attrib["full-path"])
    except KeyError:
        pass
    candidates = [
        n
        for n in zf.namelist()
        if n.endswith((".xml", ".musicxml")) and not n.startswith("META-INF/")
    ]
    if not candidates:
        raise MusicXmlError("no MusicXML file inside .mxl archive")
    return candidates[0]


def normalize(path: Path) -> NormalizeResult:
    text = read_musicxml(path)
    try:
        root = ET.fromstring(text.encode("utf-8"))
    except ET.ParseError as e:
        raise MusicXmlError(f"invalid XML: {e}") from e
    if root.tag == "score-timewise":
        raise MusicXmlError("score-timewise is not supported yet; export as partwise")
    if root.tag != "score-partwise":
        raise MusicXmlError(f"not a MusicXML score (root <{root.tag}>)")

    names = {
        sp.get("id", ""): (sp.findtext("part-name") or "").strip() for sp in root.iter("score-part")
    }
    parts: list[PartInfo] = []
    measures = 0
    for part in root.findall("part"):
        pid = part.get("id", "")
        staves = max((int(s.text) for s in part.iter("staves") if s.text), default=1)
        parts.append(PartInfo(id=pid, name=names.get(pid, pid), staves=staves))
        measures = max(measures, len(part.findall("measure")))
    return NormalizeResult(musicxml=text, measures=measures, parts=parts)
