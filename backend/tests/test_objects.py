import json
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app import illustrate, storyboard
from app.illustrate import OBJECT_SYSTEM, SvgAsset, Task, plan_tasks
from app.models import Project, Storyboard
from app.style_plan import _brief, _section_summaries
from app.svgsafe import SvgRejected, sanitize_svg
from tests.test_storyboard import COLORS
from tests.test_style_plan import _analysis

OBJECT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect x="40" y="60" width="120" height="140" fill="#a52"/></svg>'


def _board(**kw):
    return Storyboard.model_validate(
        {
            "illustration": "library",
            "cast": [{"id": "hero", "colors": COLORS}],
            "objects": [{"id": "guitar", "name": "Guitar", "description": "an old acoustic guitar", "size": "small"}],
            "scenes": [{"section_ref": 0, "setting": "road", "objects": [{"object_id": "guitar", "placement": "left"}]}],
            **kw,
        }
    )


def test_object_svg_kind_is_square_and_sanitized():
    assert sanitize_svg(OBJECT_SVG, "object").svg.startswith("<svg")
    with pytest.raises(SvgRejected):
        sanitize_svg(OBJECT_SVG.replace("0 0 200 200", "0 0 1600 900"), "object")
    assert "script" not in Storyboard.model_validate({"objects": [{"id": "o", "svg": OBJECT_SVG.replace("<rect", "<script>x</script><rect")}]}).objects[0].svg
    with pytest.raises(ValidationError):
        Storyboard.model_validate({"objects": [{"id": "Bad Id"}]})
    with pytest.raises(ValidationError):
        Storyboard.model_validate({"objects": [{"id": f"o{i}"} for i in range(9)]})


def test_validate_refs_flags_unknown_and_duplicate_objects():
    assert _board().validate_refs(2) == []
    bad = _board(objects=[{"id": "a"}, {"id": "a"}], scenes=[{"section_ref": 0, "setting": "road", "objects": [{"object_id": "ghost"}]}])
    problems = " | ".join(bad.validate_refs(2))
    assert "duplicate object ids" in problems and "unknown object 'ghost'" in problems


def test_normalize_drops_unknown_object_refs_and_dupes():
    board = _board(
        objects=[{"id": "guitar"}, {"id": "guitar"}],
        scenes=[{"section_ref": 0, "setting": "road", "objects": [{"object_id": "guitar"}, {"object_id": "ghost"}]}],
    )
    out = storyboard._normalize(board, 1)
    assert [o.id for o in out.objects] == ["guitar"]
    assert [o.object_id for o in out.scenes[0].objects] == ["guitar"]


def test_plan_tasks_always_includes_undrawn_objects():
    assert plan_tasks(_board()) == [Task("object", "guitar")]
    drawn = _board(objects=[{"id": "guitar", "svg": OBJECT_SVG}])
    assert plan_tasks(drawn) == []
    assert plan_tasks(drawn, objects={"guitar", "ghost"}) == [Task("object", "guitar")]  # explicit targets redraw


def test_run_draws_objects_and_stores_them(tmp_path):
    (tmp_path / "storyboard.json").write_text(_board().model_dump_json())
    seen = []

    class Messages:
        def parse(self, **kw):
            seen.append(kw)
            assert kw["system"] == OBJECT_SYSTEM
            return SimpleNamespace(parsed_output=SvgAsset(svg=OBJECT_SVG), stop_reason="end_turn")

    job = illustrate.ProcessJob(project_id="p", kind="illustrate")
    summary = illustrate.run(tmp_path, Project(id="p"), None, None, None, None, job, client=SimpleNamespace(beta=SimpleNamespace(messages=Messages())))
    assert summary == "drew 1 of 1" and "old acoustic guitar" in seen[0]["messages"][0]["content"]
    assert illustrate._load(tmp_path).objects[0].svg


def test_section_descriptions_reach_the_brief_and_notes_is_gone():
    project = Project(id="p", section_descriptions=["  rainy street ", ""])
    sections = _section_summaries(_analysis(3), None, "", project.section_descriptions)
    assert sections[0]["user_description"] == "rainy street"
    assert "user_description" not in sections[1] and "user_description" not in sections[2]
    assert "notes" not in json.loads(_brief(project, _analysis(3), None))
    assert "notes" not in Project(id="p").meta.model_dump()
    assert Project.model_validate({"id": "p", "meta": {"notes": "old"}}).meta.title == ""  # old project files still load


def test_storyboard_context_lists_custom_objects():
    board = _board()
    ctx = storyboard._context(Project(id="p"), _analysis(1), None, None, board.objects)
    assert '"guitar"' in ctx and "Custom objects" in ctx
