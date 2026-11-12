"""Data contract between the engine, the Rust core and the frontend.

This module is the SINGLE SOURCE of the schema. After changing it, run
``scripts/gen-types.sh`` to regenerate ``shared/schema/*.json`` and
``app/src/types/*.ts``.

Annotations are anchored to the musical position (measure + beat), never to
note IDs: music21 and Verovio assign different IDs, the position is the same.

``measure`` is always the 1-based ORDINAL of the measure in the written score:
a pickup is measure 1, and a measure split by a repeat ("7" + "7a") counts as
two. It is not the printed measure number.
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
    beat: float = Field(
        gt=0, description="1-based beat within the measure, as counted by the meter"
    )
    offset: float = Field(
        default=0.0, ge=0, description="Position from the start of the measure, in quarter notes"
    )
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
        default=None,
        description="Transposition of the first transposed occurrence, e.g. '-P5'",
    )
    hands: Literal["both", "right", "left"] = Field(
        default="both", description="Staves the pattern is in: all, or one hand of a piano"
    )
    transpositions: list[str] | None = Field(
        default=None,
        description="Per occurrence, interval from the first one ('P1', '+M2', '-P5')",
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
