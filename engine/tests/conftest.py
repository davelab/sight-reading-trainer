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
