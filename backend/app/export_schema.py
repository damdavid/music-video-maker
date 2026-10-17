"""Writes shared/schema/schema.json from the Pydantic models; web/ generates TS types from it."""

import json
from pathlib import Path

from pydantic import TypeAdapter

from app.models import AnalysisData, Lyrics, ProcessStatus, Project, ProjectSummary, RenderStatus, Storyboard, StylePlan

OUT = Path(__file__).resolve().parents[2] / "shared" / "schema" / "schema.json"


def main() -> None:
    models = [Project, AnalysisData, Lyrics, StylePlan, RenderStatus, ProjectSummary, ProcessStatus, Storyboard]
    defs: dict = {}
    for m in models:
        schema = TypeAdapter(m).json_schema(by_alias=True, mode="serialization")
        defs.update(schema.pop("$defs", {}))
        defs[m.__name__] = schema
    OUT.write_text(json.dumps({"$defs": defs}, indent=2))


if __name__ == "__main__":
    main()
