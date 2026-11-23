"""Write the JSON Schema of every exported model into a directory.

Usage: python -m score_engine.export_schema ../shared/schema
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from .models import EXPORTED_MODELS


def _strip_property_titles(node: object) -> None:
    """Drop pydantic's per-field titles so json2ts emits plain fields, not one alias per field."""
    if isinstance(node, dict):
        props = node.get("properties")
        if isinstance(props, dict):
            for prop in props.values():
                if isinstance(prop, dict):
                    prop.pop("title", None)
        for value in node.values():
            _strip_property_titles(value)
    elif isinstance(node, list):
        for value in node:
            _strip_property_titles(value)


def main(out_dir: str) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for name, model in EXPORTED_MODELS.items():
        schema = model.model_json_schema(by_alias=True, mode="serialization")
        _strip_property_titles(schema)
        (out / f"{name}.json").write_text(json.dumps(schema, indent=2, ensure_ascii=False) + "\n")
        print(f"wrote {out / f'{name}.json'}", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "../shared/schema")
