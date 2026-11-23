import pytest
from pydantic import ValidationError

from app import main, render
from app.models import Character, CharacterColors, Project, Scene, SceneCharacter, Settings, Storyboard
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
    assert board.illustration == "library" and board.scenes[0].time_of_day == "night" and board.scenes[0].crowd is None  # None: the renderer decides
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


def test_auto_cuts_default_on_and_reach_the_renderer():
    from tests.test_render import _analysis

    assert Project(id="p").settings.auto_cuts is True
    assert Project.model_validate({"id": "p", "settings": {"aspect": "9:16"}}).settings.auto_cuts is True  # projects saved before the setting
    off = Project(id="p", settings=Settings(auto_cuts=False))
    assert render.build_props(off, _analysis(), None, None)["settings"]["auto_cuts"] is False


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


def test_a_scene_keeps_what_a_character_holds_and_a_gaze_that_lands_on_someone():
    from app.storyboard import LooseScene, LooseSceneCharacter as SceneCharacter, _scene

    def scene(*chars):
        return _scene(LooseScene(section_ref=0, setting="road", characters=list(chars)), {"a", "b"}, set())["characters"]

    out = scene(
        SceneCharacter(character_id="a", holding="guitar", looks_at="b"),
        SceneCharacter(character_id="b", holding="umbrella", looks_at="camera"),
    )
    assert [(c["holding"], c["looks_at"]) for c in out] == [("guitar", "b"), ("umbrella", "camera")]

    # A gaze at nobody in the scene, at oneself, or a muddled id is dropped; "Hero" still finds "hero".
    out = scene(SceneCharacter(character_id="a", looks_at="ghost"), SceneCharacter(character_id="b", looks_at="b"))
    assert [c["looks_at"] for c in out] == [None, None]
    assert scene(SceneCharacter(character_id="a", looks_at="B"), SceneCharacter(character_id="b"))[0]["looks_at"] == "b"


def test_holding_and_looking_default_to_nothing_for_scenes_saved_before_they_existed():
    from app.models import SceneCharacter

    c = SceneCharacter.model_validate({"character_id": "a"})
    assert c.holding is None and c.looks_at is None


def test_hats_accessories_and_new_clothes_are_part_of_the_vocabulary():
    board = Storyboard.model_validate(_board(cast=[{"id": "hero", "hat": "cowboy", "outfit": "jacket", "accessories": ["scarf", "glasses"], "colors": COLORS}]))
    hero = board.cast[0]
    assert (hero.hat, hero.outfit, hero.accessories) == ("cowboy", "jacket", ["scarf", "glasses"])
    for bad in ({"hat": "fez"}, {"outfit": "toga"}, {"accessories": ["scarf", "glasses", "backpack"]}, {"accessories": ["monocle"]}):
        with pytest.raises(ValidationError):
            Storyboard.model_validate(_board(cast=[{"id": "hero", "colors": COLORS, **bad}]))
    assert Storyboard.model_validate(_board()).cast[0].hat is None


def test_the_cast_repair_keeps_hats_and_trims_accessories():
    from app.storyboard import LooseCharacter, LooseColors, _cast

    colors = LooseColors(body="#d9a37e", hair="#2b1d14", top="#3a6ea5", bottom="#2e2e3a", accent="#e85d4a")
    (hero,) = _cast([LooseCharacter(id="Hero", hat="beret", accessories=["scarf", "scarf", "glasses", "backpack"], colors=colors)])
    assert hero["hat"] == "beret" and hero["accessories"] == ["scarf", "glasses"]


def test_moods_are_stored_by_time_and_dropped_for_lines_that_do_not_exist():
    from app.models import Line, Lyrics
    from app.storyboard import LooseMood, _moods, _numbered

    lyrics = Lyrics(lines=[Line(start=1.0, end=2.0, text="a"), Line(start=5.5, end=7.0, text="b"), Line(start=9.0, end=10.0, text="c")])
    moods = _moods([LooseMood(line=2, expression="determined"), LooseMood(line=0, expression="sad"), LooseMood(line=9, expression="happy"), LooseMood(line=-1, expression="calm")], lyrics)
    assert moods == [{"at": 1.0, "expression": "sad"}, {"at": 9.0, "expression": "determined"}]
    assert _moods([LooseMood(line=0, expression="sad")], None) == []
    assert '"line": 1' in _numbered(lyrics) and _numbered(None) == ""


def test_a_scene_leaves_the_crowd_to_the_renderer_unless_claude_chose_one():
    from app.models import SceneCharacter
    from app.storyboard import LooseScene, _scene

    assert _scene(LooseScene(section_ref=0, setting="city"), set(), set())["crowd"] is None
    assert _scene(LooseScene(section_ref=0, setting="city", crowd=0), set(), set())["crowd"] == 0
    assert _scene(LooseScene(section_ref=0, setting="city", crowd=40), set(), set())["crowd"] == 8


def test_a_storyboard_saved_before_moods_still_loads_and_the_scene_keeps_what_it_held_new_items():
    board = Storyboard.model_validate(_board(scenes=[{"section_ref": 0, "setting": "road", "crowd": 3, "props": ["campfire"], "characters": [{"character_id": "hero", "holding": "balloon"}]}]))
    assert board.moods == [] and board.scenes[0].crowd == 3 and board.scenes[0].characters[0].holding == "balloon"
    assert Storyboard.model_validate(_board(moods=[{"at": 3.5, "expression": "sad"}])).moods[0].expression == "sad"


def test_new_actions_symbols_and_costume_changes_are_part_of_the_vocabulary():
    chars = [{"character_id": "hero", "action": a} for a in ("point", "lean", "cross_arms", "cheer")]
    board = Storyboard.model_validate(_board(scenes=[{"section_ref": 0, "setting": "road", "characters": chars[:3]}]))
    assert [c.action for c in board.scenes[0].characters] == ["point", "lean", "cross_arms"]
    worn = Storyboard.model_validate(_board(scenes=[{"section_ref": 0, "setting": "road", "characters": [{"character_id": "hero", "wear": {"outfit": "suit", "hat": "none", "accessories": []}}]}]))
    wear = worn.scenes[0].characters[0].wear
    assert (wear.outfit, wear.hat, wear.accessories) == ("suit", "none", [])
    assert Storyboard.model_validate(_board()).scenes[0].characters[0].wear is None
    for bad in ({"outfit": "toga"}, {"hat": "fez"}, {"accessories": ["monocle"]}):
        with pytest.raises(ValidationError):
            Storyboard.model_validate(_board(scenes=[{"section_ref": 0, "setting": "road", "characters": [{"character_id": "hero", "wear": bad}]}]))


def test_a_third_accessory_is_trimmed_instead_of_failing_the_storyboard():
    from app.models import Wear

    assert Wear(accessories=["scarf", "scarf", "glasses", "backpack"]).accessories == ["scarf", "glasses"]


def test_cues_are_stored_by_time_and_the_empty_or_misplaced_ones_dropped():
    from app.models import Line, Lyrics
    from app.storyboard import LooseCue, _cues

    lyrics = Lyrics(lines=[Line(start=1.0, end=2.0, text="a"), Line(start=5.5, end=7.0, text="b")])
    cues = _cues([LooseCue(line=1, symbol="door", holding="suitcase"), LooseCue(line=0, symbol="heart"), LooseCue(line=0), LooseCue(line=9, symbol="star")], lyrics)
    assert cues == [{"at": 1.0, "symbol": "heart", "holding": None}, {"at": 5.5, "symbol": "door", "holding": "suitcase"}]
    assert _cues([LooseCue(line=0, symbol="heart")], None) == []


def test_a_storyboard_saved_before_cues_still_loads():
    board = Storyboard.model_validate(_board(cues=[{"at": 2.0, "symbol": "bird"}]))
    assert board.cues[0].symbol == "bird" and board.cues[0].holding is None
    assert Storyboard.model_validate(_board()).cues == []


def test_a_contact_must_name_another_character_in_the_scene_and_a_character_joins_one_pair():
    from app.storyboard import LooseContact as Contact, LooseSceneCharacter as SceneCharacter, LooseScene, _scene

    def contacts(*chars):
        out = _scene(LooseScene(section_ref=0, setting="road", characters=list(chars)), {"a", "b", "c"}, set())["characters"]
        return [(c["character_id"], c["contact"]) for c in out]

    pair = contacts(SceneCharacter(character_id="a", contact=Contact(partner="B", kind="hug")), SceneCharacter(character_id="b"))
    assert pair == [("a", {"partner": "b", "kind": "hug"}), ("b", None)]  # "B" still finds "b"
    assert contacts(SceneCharacter(character_id="a", contact=Contact(partner="ghost", kind="hug")), SceneCharacter(character_id="b"))[0][1] is None
    assert contacts(SceneCharacter(character_id="a", contact=Contact(partner="a", kind="hug")))[0][1] is None
    triple = contacts(
        SceneCharacter(character_id="a", contact=Contact(partner="b", kind="hold_hands")),
        SceneCharacter(character_id="b"),
        SceneCharacter(character_id="c", contact=Contact(partner="b", kind="hug")),
    )
    assert triple[0][1] is not None and triple[2][1] is None  # b is already taken


def test_contact_kinds_are_a_closed_set_and_default_to_none():
    for bad in ("kiss", ""):
        with pytest.raises(ValidationError):
            Storyboard.model_validate(_board(scenes=[{"section_ref": 0, "setting": "road", "characters": [{"character_id": "hero", "contact": {"partner": "x", "kind": bad}}]}]))
    assert Storyboard.model_validate(_board()).scenes[0].characters[0].contact is None


def test_the_robe_outfit_and_the_sword_are_part_of_the_vocabulary():
    board = Storyboard.model_validate(_board(cast=[{"id": "hero", "outfit": "robe", "colors": COLORS}], scenes=[{"section_ref": 0, "setting": "road", "characters": [{"character_id": "hero", "holding": "sword"}]}]))
    assert board.cast[0].outfit == "robe" and board.scenes[0].characters[0].holding == "sword"
    worn = Storyboard.model_validate(_board(scenes=[{"section_ref": 0, "setting": "road", "characters": [{"character_id": "hero", "wear": {"outfit": "robe"}}]}]))
    assert worn.scenes[0].characters[0].wear.outfit == "robe"


def test_the_armor_outfit_is_part_of_the_vocabulary():
    board = Storyboard.model_validate(_board(cast=[{"id": "hero", "outfit": "armor", "colors": COLORS}]))
    assert board.cast[0].outfit == "armor"
    worn = Storyboard.model_validate(_board(scenes=[{"section_ref": 0, "setting": "road", "characters": [{"character_id": "hero", "wear": {"outfit": "armor"}}]}]))
    assert worn.scenes[0].characters[0].wear.outfit == "armor"


def test_the_helmet_hat_and_the_shield_are_part_of_the_vocabulary():
    board = Storyboard.model_validate(_board(cast=[{"id": "hero", "hat": "helmet", "outfit": "armor", "colors": COLORS}], scenes=[{"section_ref": 0, "setting": "road", "characters": [{"character_id": "hero", "holding": "shield", "wear": {"hat": "helmet"}}]}]))
    assert board.cast[0].hat == "helmet"
    assert board.scenes[0].characters[0].holding == "shield" and board.scenes[0].characters[0].wear.hat == "helmet"
