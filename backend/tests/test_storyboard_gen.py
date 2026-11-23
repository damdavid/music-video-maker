import json
from types import SimpleNamespace

import httpx
import pytest

from app import main
from app.models import CustomObject, Line, Lyrics, Scene, Storyboard, StylePlan
from app.storyboard import SYSTEM, LooseRedo, LooseScene, LooseStoryboard, _normalize, generate_storyboard, regenerate_scene
from app.style_plan import StyleError
from tests.client import make_client
from tests.test_storyboard import COLORS
from tests.test_style_plan import FakeClient, PROJECT, _analysis


def _board(scenes, cast=None):
    return Storyboard.model_validate({"cast": cast if cast is not None else [{"id": "hero", "colors": COLORS}], "scenes": scenes})


def _draft(scenes, cast=None) -> LooseStoryboard:
    return LooseStoryboard.model_validate({"cast": cast if cast is not None else [{"id": "hero", "colors": COLORS}], "scenes": scenes})


def _scene(ref, setting="road", chars=("hero",), **kw):
    return {"section_ref": ref, "setting": setting, "characters": [{"character_id": c, "action": "walk"} for c in chars], **kw}


PLAN = StylePlan.model_validate(
    {"global": {"palette": ["#101820", "#ff3366", "#f2f2f2"], "font_family": "Inter", "typography_style": "bold", "background_preset": "tunnel"}, "sections": []}
)


def test_generate_sends_storyboard_schema_system_prompt_and_context():
    client = FakeClient(_draft([_scene(0), _scene(1, "city"), _scene(2, "shore")]))
    lyrics = Lyrics(lines=[Line(start=1.0, end=2.0, text="walk alone")])
    board = generate_storyboard(PROJECT, _analysis(), lyrics, PLAN, client=client)

    call = client.calls[0]
    assert call["output_format"] is LooseStoryboard and call["system"] == SYSTEM
    assert call["model"] == "claude-opus-5-5" and call["output_config"] == {"effort": "high"} and "thinking" not in call
    user = call["messages"][0]["content"]
    assert "walk alone" in user and "#ff3366" in user  # lyrics per section and the style plan palette reach the prompt
    assert [s.setting for s in board.scenes] == ["road", "city", "shore"]


def test_normalize_drops_what_the_renderer_cannot_draw():
    messy = Storyboard.model_construct(
        illustration="library",
        cast=_board([]).cast + _board([]).cast,  # duplicate "hero"
        scenes=[
            Scene.model_validate(_scene(2, "shore")),
            Scene.model_validate(_scene(0, "road", chars=("hero", "ghost"))),
            Scene.model_validate(_scene(0, "city")),  # second scene for section 0
            Scene.model_validate(_scene(9, "field")),  # no such section
        ],
    )
    clean = _normalize(messy, 3)
    assert [c.id for c in clean.cast] == ["hero"]
    assert [(s.section_ref, s.setting) for s in clean.scenes] == [(0, "road"), (2, "shore")]  # sorted, first duplicate wins
    assert [c.character_id for c in clean.scenes[0].characters] == ["hero"]  # unknown 'ghost' removed
    assert clean.validate_refs(3) == []


def test_out_of_range_values_are_repaired_instead_of_failing_the_storyboard():
    cast = [
        {"id": "Hero", "build": 1.2, "colors": {**COLORS, "body": "tan", "hair": "abc", "top": "C0392B"}},
        *({"id": f"extra-{i}", "build": 0.1, "colors": COLORS} for i in range(6)),
        {"id": "hero", "colors": COLORS},  # collides with "Hero" once repaired
    ]
    scenes = [
        _scene(0, chars=("HERO", "ghost", "extra_0", "extra_1", "extra_2"), crowd=9, props=["lamp", "lamp", "tree", "bench", "house", "suitcase"]),
        {**_scene(1, "city"), "crowd": -3, "objects": [{"object_id": "Kite"}, {"object_id": "nope"}]},
    ]
    kite = CustomObject(id="kite", name="Kite")
    board = generate_storyboard(PROJECT, _analysis(), None, PLAN, client=FakeClient(_draft(scenes, cast)), objects=[kite])

    assert [c.id for c in board.cast] == ["hero", "extra_0", "extra_1", "extra_2", "extra_3", "extra_4"]  # at most 6
    hero = board.cast[0]
    assert hero.build == 1.15 and board.cast[1].build == 0.85
    assert hero.colors.body == "#d9a37e" and hero.colors.hair == "#aabbcc" and hero.colors.top == "#c0392b"  # defaulted / expanded / fixed
    first, second = board.scenes
    assert [c.character_id for c in first.characters] == ["hero", "extra_0", "extra_1"]  # refs follow the repaired ids, max 3
    assert first.crowd == 8 and first.props == ["lamp", "tree", "bench", "house"]
    assert second.crowd == 0 and [o.object_id for o in second.objects] == ["kite"]
    assert board.validate_refs(3) == []


def test_regenerated_scene_is_repaired_too():
    board = _board([_scene(0), _scene(1, "city"), _scene(2, "shore")])
    draft = LooseRedo(scene=LooseScene.model_validate({**_scene(1, "forest", chars=("Hero",)), "crowd": 12, "props": ["tree"] * 6}))
    scene = regenerate_scene(PROJECT, _analysis(), None, PLAN, board, 1, client=FakeClient(draft)).scene
    assert [c.character_id for c in scene.characters] == ["hero"] and scene.crowd == 8 and scene.props == ["tree"]


def test_refusal_and_empty_output_raise():
    with pytest.raises(StyleError):
        generate_storyboard(PROJECT, _analysis(), None, None, client=FakeClient(None, stop_reason="refusal"))
    with pytest.raises(StyleError):
        generate_storyboard(PROJECT, _analysis(), None, None, client=FakeClient(None, stop_reason="max_tokens"))


def test_regenerate_scene_forces_ref_and_keeps_only_cast_members():
    board = _board([_scene(0), _scene(1, "city"), _scene(2, "shore")])
    client = FakeClient(LooseRedo(scene=LooseScene.model_validate(_scene(99, "forest", chars=("hero", "ghost")))))
    scene = regenerate_scene(PROJECT, _analysis(), None, PLAN, board, 1, client=client).scene
    assert scene.section_ref == 1 and scene.setting == "forest"
    assert [c.character_id for c in scene.characters] == ["hero"]
    assert client.calls[0]["output_format"] is LooseRedo and "section 1" in client.calls[0]["messages"][0]["content"]
    with pytest.raises(IndexError):
        regenerate_scene(PROJECT, _analysis(), None, PLAN, board, 7, client=client)


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "PROJECTS_DIR", tmp_path)
    client = make_client()
    pid = client.post("/projects", files={"audio": ("a.mp3", b"x")}).json()["id"]
    (tmp_path / pid / "analysis.json").write_text(_analysis().model_dump_json())  # 3 sections
    return client, pid, tmp_path


def test_generate_and_regenerate_routes(api, monkeypatch):
    client, pid, tmp = api
    fake = FakeClient(_draft([_scene(0), _scene(1, "city"), _scene(2, "shore")]))
    monkeypatch.setattr(main.anthropic, "Anthropic", lambda **_: fake)

    assert client.post(f"/projects/{pid}/storyboard/scenes/0/regenerate").status_code == 409  # nothing to redo yet
    created = client.post(f"/projects/{pid}/storyboard/generate")
    assert created.status_code == 200 and len(created.json()["scenes"]) == 3
    assert client.get(f"/projects/{pid}/storyboard").json()["cast"][0]["id"] == "hero"  # persisted

    fake.beta.messages.parse = lambda **kw: SimpleNamespace(parsed_output=LooseRedo(scene=LooseScene.model_validate(_scene(0, "forest", time_of_day="dawn"))), stop_reason="end_turn")
    regen = client.post(f"/projects/{pid}/storyboard/scenes/1/regenerate")
    assert regen.status_code == 200 and regen.json()["scene"]["section_ref"] == 1 and regen.json()["scene"]["setting"] == "forest" and regen.json()["new_objects"] == []
    saved = {s["section_ref"]: s["setting"] for s in client.get(f"/projects/{pid}/storyboard").json()["scenes"]}
    assert saved == {0: "road", 1: "forest", 2: "shore"}  # only section 1 changed
    assert client.post(f"/projects/{pid}/storyboard/scenes/99/regenerate").status_code == 404


def test_generation_failure_is_a_502_with_the_reason(api, monkeypatch):
    client, pid, _ = api
    monkeypatch.setattr(main.anthropic, "Anthropic", lambda **_: FakeClient(None, stop_reason="refusal"))
    res = client.post(f"/projects/{pid}/storyboard/generate")
    assert res.status_code == 502 and "declined" in res.json()["detail"]
    assert client.get(f"/projects/{pid}/storyboard").status_code == 404  # nothing half-saved


def test_missing_credentials_is_a_502_not_a_crash(api, monkeypatch):
    client, pid, _ = api

    def no_credentials(**kw):
        raise main.anthropic.CredentialsError("Credentials file not found")

    fake = FakeClient(None)
    fake.beta.messages.parse = no_credentials
    monkeypatch.setattr(main.anthropic, "Anthropic", lambda **_: fake)
    res = client.post(f"/projects/{pid}/storyboard/generate")
    assert res.status_code == 502 and "Credentials" in res.json()["detail"]


def test_llm_routes_require_the_users_key(api, monkeypatch):
    client, pid, _ = api
    made = []
    monkeypatch.setattr(main.anthropic, "Anthropic", lambda **kw: made.append(kw))
    for url in (
        f"/projects/{pid}/storyboard/generate",
        f"/projects/{pid}/storyboard/scenes/0/regenerate",
        f"/projects/{pid}/style-plan",
        f"/projects/{pid}/style-plan/sections/0/regenerate",
        f"/projects/{pid}/storyboard/illustrate",
    ):
        res = client.post(url, headers={"X-Anthropic-Key": "  "})
        assert res.status_code == 401 and "API key" in res.json()["detail"], url
    assert made == []  # never falls back to the machine's credentials


def test_the_users_key_builds_the_client(api, monkeypatch):
    client, pid, _ = api
    made = []

    def build(**kw):
        made.append(kw)
        return FakeClient(_draft([_scene(0), _scene(1), _scene(2)]))

    monkeypatch.setattr(main.anthropic, "Anthropic", build)
    assert client.post(f"/projects/{pid}/storyboard/generate", headers={"X-Anthropic-Key": " sk-ant-mine "}).status_code == 200
    assert made == [{"api_key": "sk-ant-mine"}]


def test_a_rejected_key_is_a_401(api, monkeypatch):
    client, pid, _ = api

    def rejected(**kw):
        response = httpx.Response(401, request=httpx.Request("POST", "https://api.anthropic.com/v1/messages"))
        raise main.anthropic.AuthenticationError("invalid x-api-key", response=response, body=None)

    fake = FakeClient(None)
    fake.beta.messages.parse = rejected
    monkeypatch.setattr(main.anthropic, "Anthropic", lambda **_: fake)
    res = client.post(f"/projects/{pid}/storyboard/generate")
    assert res.status_code == 401 and "rejected your API key" in res.json()["detail"]


def test_generation_requires_analysis(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "PROJECTS_DIR", tmp_path)
    client = make_client()
    pid = client.post("/projects", files={"audio": ("a.mp3", b"x")}).json()["id"]
    assert client.post(f"/projects/{pid}/storyboard/generate").status_code == 409


# ---- the creator's direction is the main brief

from app.models import Project, Section  # noqa: E402
from app.storyboard import LooseNewObject, _new_objects  # noqa: E402
from app.style_plan import directions_block  # noqa: E402


def _directed(*notes: str) -> Project:
    return PROJECT.model_copy(update={"section_descriptions": list(notes)})


def test_the_directions_block_lists_only_sections_that_have_one_and_can_pick_a_single_section():
    analysis = _analysis()
    assert directions_block(PROJECT, analysis) == ""
    block = directions_block(_directed("a river at dawn", "", "  a lighthouse on a cliff "), analysis)
    assert block.startswith("The creator's directions for sections") and "Section 0" in block and "a river at dawn" in block
    assert "Section 1" not in block and "Section 2" in block and "a lighthouse on a cliff" in block
    one = directions_block(_directed("a river at dawn", "", "a lighthouse"), analysis, only=2)
    assert one.startswith("The creator's direction for this section") and "river" not in one and "lighthouse" in one


def test_generation_puts_the_directions_first_and_the_system_prompt_makes_them_the_main_brief():
    client = FakeClient(_draft([_scene(0), _scene(1), _scene(2)]))
    generate_storyboard(_directed("a river with a stone bridge"), _analysis(), None, PLAN, client=client)
    user = client.calls[0]["messages"][0]["content"]
    assert user.startswith("The creator's directions for sections") and user.index("stone bridge") < user.index("Design the cast")
    assert "main brief" in SYSTEM and "include" in SYSTEM and "new_objects" in SYSTEM


def test_each_scene_remembers_the_direction_it_was_planned_from():
    client = FakeClient(_draft([_scene(0), _scene(1), _scene(2)]))
    board = generate_storyboard(_directed("a river", "", "x" * 3000), _analysis(), None, PLAN, client=client)
    assert [s.direction_used for s in board.scenes] == ["a river", "", "x" * 2000]


def test_things_the_direction_names_are_kept_cleaned_and_limited():
    draft = _draft([_scene(0, include=[" a river ", "a river", "", "stone bridge", "y" * 100, "a", "b", "c", "d"])])
    board = generate_storyboard(_directed("river"), _analysis(), None, PLAN, client=FakeClient(draft))
    assert board.scenes[0].include == ["a river", "stone bridge", "y" * 60, "a", "b", "c"]


def test_new_objects_get_safe_unique_ids_and_stay_within_the_boards_limit():
    made = _new_objects([LooseNewObject(id="Light House!", name=" Lighthouse ", description="tall", size="large"), LooseNewObject(id="light_house"), LooseNewObject(id="kite"), LooseNewObject(id="")], {"kite"})
    assert made == [{"id": "light_house", "name": "Lighthouse", "description": "tall", "size": "large"}]
    full = _new_objects([LooseNewObject(id="a"), LooseNewObject(id="b")], {f"o{i}" for i in range(7)})
    assert [o["id"] for o in full] == ["a"]


def test_a_new_object_can_be_placed_in_a_scene_and_joins_the_boards_objects():
    draft = _draft([_scene(0, objects=[{"object_id": "Lighthouse", "placement": "right"}, {"object_id": "ghost"}])])
    draft.new_objects = [LooseNewObject(id="lighthouse", name="Lighthouse", description="a tall white tower", size="large")]
    board = generate_storyboard(_directed("a lighthouse"), _analysis(), None, PLAN, client=FakeClient(draft))
    assert [o.id for o in board.objects] == ["lighthouse"] and board.objects[0].svg is None  # its art is drawn with Draw art
    assert [o.object_id for o in board.scenes[0].objects] == ["lighthouse"]


def test_redoing_a_scene_leads_with_its_direction_and_can_add_objects():
    board = _board([_scene(0), _scene(1, "city"), _scene(2, "shore")])
    draft = LooseRedo(scene=LooseScene.model_validate({**_scene(1, "shore"), "include": ["a pier"], "objects": [{"object_id": "pier"}]}), new_objects=[LooseNewObject(id="pier", name="Pier", description="a wooden pier")])
    client = FakeClient(draft)
    redo = regenerate_scene(_directed("", "a wooden pier at sunset"), _analysis(), None, PLAN, board, 1, client=client)
    user = client.calls[0]["messages"][0]["content"]
    assert user.startswith("The creator's direction for this section") and "wooden pier at sunset" in user
    assert redo.scene.direction_used == "a wooden pier at sunset" and redo.scene.include == ["a pier"]
    assert [o.id for o in redo.new_objects] == ["pier"] and [o.object_id for o in redo.scene.objects] == ["pier"]


def test_the_redo_route_adds_new_objects_to_the_saved_board(api, monkeypatch):
    client, pid, _ = api
    fake = FakeClient(_draft([_scene(0), _scene(1), _scene(2)]))
    monkeypatch.setattr(main.anthropic, "Anthropic", lambda **_: fake)
    client.post(f"/projects/{pid}/storyboard/generate")
    redo = LooseRedo(scene=LooseScene.model_validate({**_scene(1, "shore"), "objects": [{"object_id": "pier"}]}), new_objects=[LooseNewObject(id="pier", name="Pier")])
    fake.beta.messages.parse = lambda **kw: SimpleNamespace(parsed_output=redo, stop_reason="end_turn")
    res = client.post(f"/projects/{pid}/storyboard/scenes/1/regenerate")
    assert res.status_code == 200 and [o["id"] for o in res.json()["new_objects"]] == ["pier"]
    saved = client.get(f"/projects/{pid}/storyboard").json()
    assert [o["id"] for o in saved["objects"]] == ["pier"]
