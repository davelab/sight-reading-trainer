from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def minuet_path() -> Path:
    return FIXTURES / "minuet-in-g.musicxml"
