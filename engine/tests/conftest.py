from pathlib import Path

import pytest
from music21 import corpus
from music21.musicxml.m21ToXml import GeneralObjectExporter

FIXTURES = Path(__file__).parent / "fixtures"

# Bach chorales come from the music21 corpus at test time: the encodings are
# included in music21 by permission and are not redistributed in this repo.
CHORALES = {"bwv269": "bach/bwv269", "bwv17.7": "bach/bwv17.7"}


@pytest.fixture
def minuet_path() -> Path:
    return FIXTURES / "minuet-in-g.musicxml"


@pytest.fixture(scope="session")
def chorale(tmp_path_factory):
    """Return a function giving the MusicXML path of a corpus chorale ("bwv269")."""
    cache: dict[str, Path] = {}

    def get(name: str) -> Path:
        if name not in cache:
            xml = GeneralObjectExporter(corpus.parse(CHORALES[name])).parse().decode("utf-8")
            path = tmp_path_factory.mktemp("chorales") / f"{name}.musicxml"
            path.write_text(xml)
            cache[name] = path
        return cache[name]

    return get


def overfill_measure_4(xml: str) -> str:
    """Minuet with measure 4's right-hand G5 a quarter too long, as an OMR error would be.

    The <backup> grows too, as a MusicXML writer backs up over what it wrote.
    """
    head, rest = xml.split('<measure number="4">', 1)
    body, tail = rest.split("</measure>", 1)
    g5 = "<step>G</step><octave>5</octave></pitch><duration>2</duration>"
    assert g5 in body
    body = body.replace(g5, g5.replace("<duration>2", "<duration>4"), 1)
    body = body.replace("<backup><duration>6</duration>", "<backup><duration>8</duration>", 1)
    return head + '<measure number="4">' + body + "</measure>" + tail
