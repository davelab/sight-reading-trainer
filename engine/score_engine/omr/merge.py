"""Join the per-page MusicXML files of a recognised PDF into one score.

homr's own merge (relieur) drops a page's <divisions> when it equals the
FIRST page's value, even if a page in between changed it: every duration of
that page is then read in the wrong unit (e.g. 3/4 measures read as 9/8).
Here each page keeps the attributes it needs:
- <divisions> always, at its first measure (it is invisible);
- key, time and clefs only where they differ from the running values, so
  they are not drawn again at every page.
Measures are renumbered 1..n.
"""

from __future__ import annotations

import copy
import xml.etree.ElementTree as ET
from fractions import Fraction
from pathlib import Path

ATTRIBUTE_ORDER = ["divisions", "key", "time", "staves", "part-symbol", "instruments", "clef"]


class MergeError(ValueError):
    pass


def _signature(el: ET.Element | None) -> str | None:
    return None if el is None else ET.tostring(el, encoding="unicode").strip()


def merge_pages(pages: list[str]) -> str:
    """Merge partwise MusicXML strings (one per page) into one score."""
    if not pages:
        raise MergeError("no pages")
    roots = [ET.fromstring(p.encode("utf-8")) for p in pages]
    first = roots[0]
    parts = first.findall("part")
    if any(len(r.findall("part")) != len(parts) for r in roots):
        raise MergeError("pages have different numbers of parts")

    for index, part in enumerate(parts):
        # Running attribute values as seen so far in the merged part.
        running: dict[str, str | None] = {"divisions": None, "key": None, "time": None}
        clefs: dict[str, str | None] = {}
        measures: list[ET.Element] = []
        for page_number, root in enumerate(roots):
            page_measures = root.findall("part")[index].findall("measure")
            for m_index, measure in enumerate(page_measures):
                measure = measure if page_number == 0 else copy.deepcopy(measure)
                attrs = measure.find("attributes")
                page_start = m_index == 0
                if attrs is not None:
                    if page_start and page_number > 0:
                        _keep_running_meter(attrs, running)
                    _dedupe(attrs, running, clefs, keep_divisions=page_start)
                    if len(attrs) == 0:
                        measure.remove(attrs)
                if page_start and page_number > 0:
                    _ensure_divisions(measure, running, root.findall("part")[index])
                measures.append(measure)
        for old in part.findall("measure"):
            part.remove(old)
        for number, measure in enumerate(measures, start=1):
            measure.set("number", str(number))
            part.append(measure)

    body = ET.tostring(first, encoding="unicode")
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + body + "\n"


def _quarters(time_sig: str | None) -> Fraction | None:
    if time_sig is None:
        return None
    el = ET.fromstring(time_sig)
    try:
        return Fraction(int(el.findtext("beats", "0")) * 4, int(el.findtext("beat-type", "4")))
    except (ValueError, ZeroDivisionError):
        return None


def _keep_running_meter(attrs: ET.Element, running: dict[str, str | None]) -> None:
    """A page is read on its own: its first time signature is a guess when homr saw
    none there. The same measure length as the meter in force (4/4 after 2/2) means
    the meter goes on."""
    time = attrs.find("time")
    if time is not None and running["time"] is not None:
        if _quarters(_signature(time)) == _quarters(running["time"]):
            attrs.remove(time)


def _dedupe(
    attrs: ET.Element,
    running: dict[str, str | None],
    clefs: dict[str, str | None],
    keep_divisions: bool,
) -> None:
    for child in list(attrs):
        tag = child.tag
        if tag == "clef":
            number = child.get("number", "1")
            sig = _signature(child)
            if clefs.get(number) == sig:
                attrs.remove(child)
            else:
                clefs[number] = sig
        elif tag in ("key", "time"):
            sig = _signature(child)
            if running[tag] == sig:
                attrs.remove(child)
            else:
                running[tag] = sig
        elif tag == "divisions":
            value = (child.text or "").strip()
            if running["divisions"] == value and not keep_divisions:
                attrs.remove(child)
            else:
                running["divisions"] = value


def _ensure_divisions(
    measure: ET.Element, running: dict[str, str | None], page_part: ET.Element
) -> None:
    """A page's first measure must state its divisions, inherited or not."""
    attrs = measure.find("attributes")
    if attrs is not None and attrs.find("divisions") is not None:
        return
    # The page itself never stated it: its unit is the one in force where the page began.
    value = running["divisions"]
    if value is None:
        return
    if attrs is None:
        attrs = ET.Element("attributes")
        measure.insert(0, attrs)
    div = ET.Element("divisions")
    div.text = value
    attrs.insert(0, div)


def merge_files(pages: list[Path], out: Path) -> Path:
    out.write_text(merge_pages([p.read_text(encoding="utf-8") for p in pages]), encoding="utf-8")
    return out
