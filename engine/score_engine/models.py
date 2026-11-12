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


# --- OMR import and correction ----------------------------------------------------


class NoteRef(_Model):
    """A note found by position (never by ID): what the review screen sends to edit."""

    measure: int = Field(ge=1, description="Measure ordinal in the written score")
    staff: int = Field(ge=1, description="Global staff number: staves of all parts in order")
    offset: float = Field(ge=0, description="Onset in quarter notes from the downbeat")
    pitch: int = Field(ge=0, le=127, description="MIDI pitch")


EditAction = Literal[
    # pitch
    "step-up", "step-down", "octave-up", "octave-down", "sharp", "flat", "natural",
    # rhythm (set-duration takes `value`: whole, half, quarter, eighth, 16th, 32nd, 64th)
    "set-duration", "toggle-dot", "triplet", "triplet-measure",
    # structure
    "insert-after", "toggle-chord", "delete", "delete-time",
]  # fmt: skip


class OmrWarning(_Model):
    measure: int = Field(ge=1)
    staff: int | None = None
    kind: Literal["duration", "page"]
    message: str


class CheckResult(_Model):
    """Result of ``score.check`` and ``score.edit``."""

    musicxml: str
    warnings: list[OmrWarning]
    note: NoteRef | None = Field(
        default=None, description="score.edit: where the edited (or inserted) note is now"
    )


class OmrResult(_Model):
    """Payload of the ``omr.done`` notification."""

    job_id: str = Field(alias="jobId")
    musicxml: str
    pages: int = Field(ge=1)
    previews: list[str] = Field(description="One data: URI image per recognised page")
    warnings: list[OmrWarning]


class OmrProgress(_Model):
    """Payload of the ``omr.progress`` notification."""

    job_id: str = Field(alias="jobId")
    stage: Literal["render", "download", "recognize", "merge"]
    page: int = Field(ge=0)
    total: int = Field(ge=0)


class TranscribeHints(_Model):
    """What the user already knows about the piece (``transcribe.run``); every field
    is optional and the transcription infers what is missing."""

    tempo: float | None = Field(
        default=None, ge=20, le=300, description="Approximate quarter notes per minute"
    )
    beats_per_measure: int | None = Field(
        default=None,
        alias="beatsPerMeasure",
        ge=2,
        le=4,
        description="Quarter-note meter: 2, 3 or 4",
    )
    key: str | None = Field(
        default=None,
        pattern=r"^[A-G](#|b)? (major|minor)$",
        description="e.g. 'G major', 'Bb minor'",
    )
    pickup_beats: int | None = Field(
        default=None, alias="pickupBeats", ge=0, le=3, description="Beats before the first bar line"
    )


class TranscribeFacts(_Model):
    """What the transcription inferred about the performance."""

    tempo: int = Field(ge=1, description="Median beat, in quarter notes per minute")
    beats_per_measure: int = Field(alias="beatsPerMeasure", ge=1)
    key: str = Field(description="e.g. 'G major', 'Bb minor'")
    pickup_beats: float = Field(alias="pickupBeats", ge=0)


class TranscribeResult(_Model):
    """Payload of the ``transcribe.done`` notification."""

    job_id: str = Field(alias="jobId")
    musicxml: str
    midi: str = Field(
        description="The performance as played (with pedal), base64 Standard MIDI File"
    )
    duration: float = Field(ge=0, description="Seconds of audio")
    notes: int = Field(ge=0, description="Notes detected")
    facts: TranscribeFacts
    warnings: list[OmrWarning]


class TranscribeProgress(_Model):
    """Payload of the ``transcribe.progress`` notification."""

    job_id: str = Field(alias="jobId")
    stage: Literal["load", "model", "notation"]
    fraction: float = Field(ge=0, le=1, description="Progress of the current stage")


EXPORTED_MODELS: dict[str, type[BaseModel]] = {
    "Analysis": Analysis,
    "PingResult": PingResult,
    "NormalizeResult": NormalizeResult,
    "NoteRef": NoteRef,
    "CheckResult": CheckResult,
    "OmrResult": OmrResult,
    "OmrProgress": OmrProgress,
    "TranscribeResult": TranscribeResult,
    "TranscribeProgress": TranscribeProgress,
    "TranscribeHints": TranscribeHints,
}
