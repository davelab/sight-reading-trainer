"""Data contract between the engine, the Rust core and the frontend.

This module is the SINGLE SOURCE of the schema. After changing it, run
``scripts/gen-types.sh`` to regenerate ``shared/schema/*.json`` and
``app/src/types/*.ts``.

Annotations are anchored to the musical position (measure + beat), never to
note IDs: music21 and Verovio assign different IDs, the position is the same.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = 1


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


# --- Analysis -----------------------------------------------------------------


class KeyRegion(_Model):
    from_measure: int = Field(alias="fromMeasure", ge=1)
    to_measure: int = Field(alias="toMeasure", ge=1)
    tonic: str = Field(description="Pitch class name, e.g. 'G', 'F#', 'Bb'")
    mode: Literal["major", "minor"]
    confidence: float = Field(ge=0, le=1)


class Chord(_Model):
    measure: int = Field(ge=1)
    beat: float = Field(ge=1, description="1-based beat within the measure")
    symbol: str = Field(description="Chord symbol, e.g. 'D7'")
    roman: str = Field(description="Roman numeral in the local key, e.g. 'V7'")
    function: Literal["tonic", "predominant", "dominant", "other"]
    confidence: float | None = Field(default=None, ge=0, le=1)


class Pattern(_Model):
    id: str
    kind: Literal["exact", "transposed", "variant"]
    length: int = Field(ge=1, description="Length in measures")
    occurrences: list[int] = Field(description="Starting measure of every occurrence")
    interval: str | None = Field(
        default=None, description="Transposition interval for kind='transposed', e.g. 'P4'"
    )


class Section(_Model):
    label: str
    from_measure: int = Field(alias="fromMeasure", ge=1)
    to_measure: int = Field(alias="toMeasure", ge=1)


class Analysis(_Model):
    """Result of the ``analyze`` JSON-RPC method."""

    schema_version: Literal[1] = Field(default=SCHEMA_VERSION, alias="schemaVersion")
    key: list[KeyRegion] = Field(default_factory=list)
    chords: list[Chord] = Field(default_factory=list)
    patterns: list[Pattern] = Field(default_factory=list)
    sections: list[Section] = Field(default_factory=list)


# --- RPC results --------------------------------------------------------------


class PingResult(_Model):
    version: str


class PartInfo(_Model):
    id: str
    name: str
    staves: int = Field(ge=1)


class NormalizeResult(_Model):
    """Result of ``score.normalize``."""

    musicxml: str
    measures: int = Field(ge=0)
    parts: list[PartInfo]


EXPORTED_MODELS: dict[str, type[BaseModel]] = {
    "Analysis": Analysis,
    "PingResult": PingResult,
    "NormalizeResult": NormalizeResult,
}
