import pytest
from pydantic import ValidationError

from app import main, render
from app.models import Character, CharacterColors, Project, Scene, SceneCharacter, Storyboard
from tests.client import make_client

COLORS = {"body": "#d9a37e", "hair": "#2b1d14", "top": "#c0392b", "bottom": "#1f2a44", "accent": "#f1c40f"}


def _board(**kw):
    return {
        "cast": [{"id": "hero", "name": "Hero", "colors": COLORS}],
        "scenes": [{"section_ref": 0, "setting": "road", "characters": [{"character_id": "hero", "action": "walk"}]}],
        **kw,
    }


def test_defaults_and_vocabulary_are_enforced():
    board = Storyboard.model_validate(_board())
    assert board.illustration == "library" and board.scenes[0].time_of_day == "night" and board.scenes[0].crowd == 0
    assert board.scenes[0].characters[0].expression is None  # the renderer picks one from the action
    for bad in (
        {"scenes": [{"section_ref": 0, "setting": "moon"}]},
        {"scenes": [{"section_ref": 0, "setting": "road", "characters": [{"character_id": "hero", "action": "moonwalk"}]}]},
        {"scenes": [{"section_ref": 0, "setting": "road", "characters": [{"character_id": "hero", "expression": "smug"}]}]},
        {"scenes": [{"section_ref": 0, "setting": "road", "crowd": 99}]},
        {"scenes": [{"section_ref": 0, "setting": "road", "props": ["lamp"] * 5}]},
        {"cast": [{"id": "Has Spaces", "colors": COLORS}]},
        {"cast": [{"id": "hero", "colors": {**COLORS, "body": "tan"}}]},
        {"cast": [{"id": "hero", "build": 2.0, "colors": COLORS}]},
    ):
        with pytest.raises(ValidationError):
            Storyboard.model_validate(_board(**bad))


def test_validate_refs_reports_each_problem():
    ok = Storyboard.model_validate(_board())
    assert ok.validate_refs(2) == []
    board = Storyboard.model_validate(
        _board(
            cast=[{"id": "hero", "colors": COLORS}, {"id": "hero", "colors": COLORS}],
            scenes=[
                {"section_ref": 5, "setting": "road"},
                {"section_ref": 0, "setting": "city", "characters": [{"character_id": "ghost"}]},
                {"section_ref": 0, "setting": "field"},
            ],
        )
    )
    problems = " | ".join(board.validate_refs(2))
    assert "duplicate character ids" in problems and "missing section 5" in problems
    assert "unknown character 'ghost'" in problems and "more than one scene for section 0" in problems


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "PROJECTS_DIR", tmp_path)
    client = make_client()
    pid = client.post("/projects", files={"audio": ("a.mp3", b"x")}).json()["id"]
    return client, pid, tmp_path


def test_storyboard_routes_round_trip_and_validate(api):
    client, pid, tmp = api
    assert client.get(f"/projects/{pid}/storyboard").status_code == 404
    assert client.put(f"/projects/{pid}/storyboard", json=_board()).status_code == 200
    assert client.get(f"/projects/{pid}/storyboard").json()["cast"][0]["id"] == "hero"

    bad = _board(scenes=[{"section_ref": 0, "setting": "road", "characters": [{"character_id": "ghost"}]}])
    res = client.put(f"/projects/{pid}/storyboard", json=bad)
    assert res.status_code == 422 and "ghost" in res.json()["detail"]
    assert client.get(f"/projects/{pid}/storyboard").json()["cast"][0]["id"] == "hero"  # bad save left it untouched
    assert client.put(f"/projects/{pid}/storyboard", json={"scenes": [{"section_ref": 0, "setting": "mars"}]}).status_code == 422


def test_section_refs_are_checked_against_analysis_when_present(api):
    client, pid, tmp = api
    from tests.test_render import _analysis

    (tmp / pid / "analysis.json").write_text(_analysis().model_dump_json())  # one section
    board = _board(scenes=[{"section_ref": 3, "setting": "road"}])
    assert "missing section 3" in client.put(f"/projects/{pid}/storyboard", json=board).json()["detail"]


def test_build_props_carries_storyboard_and_visual_mode():
    from tests.test_render import _analysis

    board = Storyboard(cast=[Character(id="hero", colors=CharacterColors(**COLORS))], scenes=[Scene(section_ref=0, setting="road", characters=[SceneCharacter(character_id="hero")])])
    props = render.build_props(Project(id="p"), _analysis(), None, None, board)
    assert props["storyboard"]["scenes"][0]["setting"] == "road" and props["settings"]["visual_mode"] == "abstract"
    assert render.build_props(Project(id="p"), _analysis(), None, None)["storyboard"] is None


FIGURE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 200"><g id="arm_r" data-pivot="55,60"><rect x="52" y="60" width="6" height="45" fill="#c33"/></g></svg>'
BACKDROP = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><rect x="0" y="0" width="1600" height="900" fill="#123"/></svg>'


def test_claude_never_sees_the_art_fields():
    import json

    from app.storyboard import LooseScene, LooseStoryboard

    draft = json.dumps(LooseStoryboard.model_json_schema()) + json.dumps(LooseScene.model_json_schema())
    assert "svg" not in draft and "illustration" not in draft  # a planning call must not try to draw
    stored = json.dumps(Storyboard.model_json_schema())
    assert "background_svg" in stored and '"svg"' in stored and "illustration" in stored


def test_art_is_sanitized_when_a_storyboard_is_validated():
    dirty = FIGURE.replace("<g ", '<script>alert(1)</script><g onclick="x()" ')
    board = Storyboard.model_validate(_board(cast=[{"id": "hero", "colors": COLORS, "svg": dirty}], scenes=[{"section_ref": 0, "setting": "road", "background_svg": BACKDROP}]))
    assert "script" not in board.cast[0].svg and "onclick" not in board.cast[0].svg and 'id="arm_r"' in board.cast[0].svg
    assert board.scenes[0].background_svg.startswith("<svg")


def test_unusable_art_is_rejected_with_a_readable_reason():
    with pytest.raises(ValidationError, match="aspect ratio"):
        Storyboard.model_validate(_board(cast=[{"id": "hero", "colors": COLORS, "svg": BACKDROP}]))  # a 16:9 drawing as a figure
    with pytest.raises(ValidationError, match="not well-formed"):
        Storyboard.model_validate(_board(scenes=[{"section_ref": 0, "setting": "road", "background_svg": "<svg"}]))


def test_effective_illustration_prefers_the_scene_override():
    board = Storyboard.model_validate(_board(illustration="freeform", scenes=[{"section_ref": 0, "setting": "road", "illustration": "library"}, {"section_ref": 1, "setting": "city"}]))
    assert board.effective_illustration(board.scenes[0]) == "library"
    assert board.effective_illustration(board.scenes[1]) == "freeform"
    assert Storyboard.model_validate(_board()).effective_illustration(Storyboard.model_validate(_board()).scenes[0]) == "library"


def test_api_rejects_unsafe_art_and_stores_the_cleaned_version(api):
    client, pid, tmp = api
    dirty = FIGURE.replace("<g ", "<script>alert(1)</script><g ")
    res = client.put(f"/projects/{pid}/storyboard", json=_board(cast=[{"id": "hero", "colors": COLORS, "svg": dirty}]))
    assert res.status_code == 200 and "script" not in res.json()["cast"][0]["svg"]
    stored = (tmp / pid / "storyboard.json").read_text()
    assert "alert" not in stored and "<script" not in stored  # what is on disk is the cleaned version
    bad = client.put(f"/projects/{pid}/storyboard", json=_board(cast=[{"id": "hero", "colors": COLORS, "svg": "<html/>"}]))
    assert bad.status_code == 422 and "root element" in str(bad.json())
