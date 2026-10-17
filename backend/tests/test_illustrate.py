import json
import threading
import time
from types import SimpleNamespace

import pytest

from app import illustrate, jobs, main, render
from app.illustrate import BACKGROUND_SYSTEM, FIGURE_SYSTEM, SvgAsset, Task, plan_tasks
from app.models import Project, Storyboard
from tests.client import make_client
from tests.test_storyboard import BACKDROP, COLORS, FIGURE
from tests.test_style_plan import _analysis


def _board(illustration="freeform", scene_overrides=None, cast_svg=None):
    scene_overrides = scene_overrides or {}
    return Storyboard.model_validate(
        {
            "illustration": illustration,
            "cast": [{"id": "hero", "name": "Hero", "colors": COLORS, "svg": cast_svg}, {"id": "extra", "colors": COLORS}],
            "scenes": [
                {"section_ref": 0, "setting": "road", "characters": [{"character_id": "hero", "action": "walk"}], **scene_overrides.get(0, {})},
                {"section_ref": 1, "setting": "shore", "characters": [{"character_id": "hero", "action": "sit"}], **scene_overrides.get(1, {})},
            ],
        }
    )


class FakeClaude:
    """Thread-safe stand-in for the Anthropic client: answers by the system prompt, records every call."""

    def __init__(self, figure=FIGURE, backdrop=BACKDROP, fail_on=(), reject_first=False, hook=None):
        self.calls, self.figure, self.backdrop, self.fail_on, self.reject_first, self.hook = [], figure, backdrop, fail_on, reject_first, hook
        self._lock = threading.Lock()
        outer = self

        class Messages:
            def parse(self, **kw):
                with outer._lock:
                    outer.calls.append(kw)
                if outer.hook:
                    outer.hook()
                is_figure = kw["system"] == FIGURE_SYSTEM
                text = kw["messages"][0]["content"]
                if any(tag in text for tag in outer.fail_on):
                    return SimpleNamespace(parsed_output=None, stop_reason="refusal")
                if outer.reject_first and "previous drawing was rejected" not in text:
                    return SimpleNamespace(parsed_output=SvgAsset(svg="<html><script>x</script></html>"), stop_reason="end_turn")
                return SimpleNamespace(parsed_output=SvgAsset(svg=outer.figure if is_figure else outer.backdrop), stop_reason="end_turn")

        self.beta = SimpleNamespace(messages=Messages())


def _job():
    j = jobs.ProcessJob(project_id="p", kind="illustrate")
    seen = []
    original = j.report
    j.report = lambda stage, progress: (seen.append((stage, round(progress, 3))), original(stage, progress))[1]
    return j, seen


def _project(tmp_path, board):
    (tmp_path / "storyboard.json").write_text(board.model_dump_json())
    return Project(id="p")


def test_plan_tasks_defaults_to_missing_art_in_freeform_scenes_only():
    assert plan_tasks(_board()) == [Task("character", "hero"), Task("scene", 0), Task("scene", 1)]  # "extra" never appears in a scene
    assert plan_tasks(_board("library")) == []
    mixed = _board("library", {1: {"illustration": "freeform"}})
    assert plan_tasks(mixed) == [Task("character", "hero"), Task("scene", 1)]
    drawn = _board(cast_svg=FIGURE, scene_overrides={0: {"background_svg": BACKDROP}})
    assert plan_tasks(drawn) == [Task("scene", 1)]  # only what is missing


def test_explicit_targets_are_always_redrawn_and_unknown_ones_ignored():
    drawn = _board(cast_svg=FIGURE, scene_overrides={0: {"background_svg": BACKDROP}, 1: {"background_svg": BACKDROP}})
    assert plan_tasks(drawn) == []
    assert plan_tasks(drawn, scenes={0}, characters={"hero", "ghost"}) == [Task("character", "hero"), Task("scene", 0)]
    assert plan_tasks(drawn, scenes={9}) == []


def test_run_draws_everything_saves_sanitized_art_and_reports_monotonic_progress(tmp_path):
    claude = FakeClaude(figure=FIGURE.replace("<g ", "<script>alert(1)</script><g ", 1))
    job, seen = _job()
    summary = illustrate.run(tmp_path, _project(tmp_path, _board()), None, None, None, None, job, client=claude)
    assert summary == "drew 3 of 3"
    saved = Storyboard.model_validate_json((tmp_path / "storyboard.json").read_text())
    assert saved.cast[0].svg and "alert" not in saved.cast[0].svg and 'id="arm_r"' in saved.cast[0].svg
    assert all(s.background_svg for s in saved.scenes) and saved.cast[1].svg is None
    fractions = [f for _, f in seen]
    assert fractions == sorted(fractions) and seen[0][0] == "drawing 0 of 3" and seen[-1][0] == "drawing 3 of 3" and fractions[-1] < 1
    figure_call = next(c for c in claude.calls if c["system"] == FIGURE_SYSTEM)
    assert figure_call["output_format"] is SvgAsset and figure_call["output_config"] == {"effort": "high"} and figure_call["max_tokens"] == illustrate.MAX_TOKENS
    assert "Hero" in figure_call["messages"][0]["content"]
    bg = next(c for c in claude.calls if c["system"] == BACKGROUND_SYSTEM and '"setting": "shore"' in c["messages"][0]["content"])
    assert '"someone_sits": true' in bg["messages"][0]["content"]  # told the renderer will add the bench


def test_a_rejected_drawing_is_retried_once_with_the_reason(tmp_path):
    claude = FakeClaude(reject_first=True)
    job, _ = _job()
    summary = illustrate.run(tmp_path, _project(tmp_path, _board()), None, {0}, None, None, job, client=claude)
    assert summary == "drew 1 of 1"
    prompts = [c["messages"][0]["content"] for c in claude.calls]
    assert len(prompts) == 2 and "previous drawing was rejected" in prompts[1] and "root element" in prompts[1]


def test_a_drawing_rejected_twice_fails_that_asset_only(tmp_path):
    claude = FakeClaude(figure="<html/>")  # the figure is never valid; the backdrops are fine
    job, _ = _job()
    summary = illustrate.run(tmp_path, _project(tmp_path, _board()), None, None, None, None, job, client=claude)
    assert summary.startswith("drew 2 of 3") and "character hero" in summary and "rejected twice" in summary
    saved = Storyboard.model_validate_json((tmp_path / "storyboard.json").read_text())
    assert saved.cast[0].svg is None and all(s.background_svg for s in saved.scenes)


def test_every_drawing_failing_is_an_error_not_a_quiet_success(tmp_path):
    job, _ = _job()
    with pytest.raises(RuntimeError, match="drew 0 of 3"):
        illustrate.run(tmp_path, _project(tmp_path, _board()), None, None, None, None, job, client=FakeClaude(fail_on=("Draw", "Paint")))


def test_store_never_writes_unsanitized_or_oversized_art(tmp_path):
    from app.svgsafe import MAX_CHARS

    _project(tmp_path, _board())
    with pytest.raises(ValueError):
        illustrate._store(tmp_path, Task("character", "hero"), "<svg" + " " * MAX_CHARS)
    illustrate._store(tmp_path, Task("character", "hero"), FIGURE.replace("<g ", '<g onclick="x()" ', 1))
    saved = Storyboard.model_validate_json((tmp_path / "storyboard.json").read_text())
    assert "onclick" not in saved.cast[0].svg and 'id="arm_r"' in saved.cast[0].svg


def test_an_edit_made_while_drawing_is_not_overwritten(tmp_path):
    board = _board()
    project = _project(tmp_path, board)

    def edit_midway():
        # Simulates the user saving a change to the storyboard while Claude is still drawing.
        with illustrate.board_lock:
            current = Storyboard.model_validate_json((tmp_path / "storyboard.json").read_text())
            current.scenes[0].description = "edited by the user"
            (tmp_path / "storyboard.json").write_text(current.model_dump_json())

    claude = FakeClaude(hook=lambda: edit_midway() if not getattr(edit_midway, "done", False) and setattr(edit_midway, "done", True) is None else None)
    job, _ = _job()
    illustrate.run(tmp_path, project, None, {0}, None, None, job, client=claude)
    saved = Storyboard.model_validate_json((tmp_path / "storyboard.json").read_text())
    assert saved.scenes[0].description == "edited by the user" and saved.scenes[0].background_svg


def test_art_for_a_removed_asset_is_skipped_quietly(tmp_path):
    board = _board()
    project = _project(tmp_path, board)
    claude = FakeClaude(hook=lambda: (tmp_path / "storyboard.json").write_text(Storyboard(cast=[], scenes=[]).model_dump_json()))
    job, _ = _job()
    assert illustrate.run(tmp_path, project, None, {0}, None, None, job, client=claude) == "drew 1 of 1"  # nothing to attach it to; no crash
    assert Storyboard.model_validate_json((tmp_path / "storyboard.json").read_text()).scenes == []


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "PROJECTS_DIR", tmp_path)
    jobs.JOBS.clear()
    render.JOBS.clear()
    client = make_client()
    pid = client.post("/projects", files={"audio": ("a.mp3", b"x")}).json()["id"]
    (tmp_path / pid / "analysis.json").write_text(_analysis().model_dump_json())
    return client, pid, tmp_path


def _wait(client, pid):
    for _ in range(200):
        st = client.get(f"/projects/{pid}/storyboard/illustrate").json()
        if st["state"] in ("done", "error"):
            return st
        time.sleep(0.05)
    raise AssertionError("illustration did not finish")


def test_illustrate_routes(api, monkeypatch):
    client, pid, tmp = api
    assert client.post(f"/projects/{pid}/storyboard/illustrate").status_code == 409  # no storyboard yet
    assert client.get(f"/projects/{pid}/storyboard/illustrate").status_code == 404
    client.put(f"/projects/{pid}/storyboard", json=_board("library").model_dump())
    assert client.post(f"/projects/{pid}/storyboard/illustrate").status_code == 422  # nothing is free-form

    client.put(f"/projects/{pid}/storyboard", json=_board("freeform").model_dump())
    fake = FakeClaude()
    monkeypatch.setattr(illustrate.anthropic, "Anthropic", lambda **_: fake)
    started = client.post(f"/projects/{pid}/storyboard/illustrate")
    assert started.status_code == 202
    final = _wait(client, pid)
    assert final["state"] == "done" and final["stage"] == "drew 3 of 3" and final["progress"] == 1
    board = client.get(f"/projects/{pid}/storyboard").json()
    assert board["cast"][0]["svg"].startswith("<svg") and board["scenes"][1]["background_svg"].startswith("<svg")
    assert client.get(f"/projects/{pid}/process").status_code == 404  # a different kind of job, tracked separately

    assert client.post(f"/projects/{pid}/storyboard/illustrate").status_code == 422  # all art present now
    again = client.post(f"/projects/{pid}/storyboard/illustrate?scene=1&character=hero")
    assert again.status_code == 202 and _wait(client, pid)["stage"] == "drew 2 of 2"  # explicit targets redraw


def test_illustrate_is_blocked_while_another_job_runs(api, monkeypatch):
    client, pid, tmp = api
    client.put(f"/projects/{pid}/storyboard", json=_board("freeform").model_dump())
    gate = threading.Event()
    monkeypatch.setattr(illustrate.anthropic, "Anthropic", lambda **_: FakeClaude(hook=lambda: gate.wait(5)))
    assert client.post(f"/projects/{pid}/storyboard/illustrate").status_code == 202
    assert client.post(f"/projects/{pid}/storyboard/illustrate?scene=0").status_code == 409
    assert client.post(f"/projects/{pid}/process").status_code == 409
    assert client.post(f"/projects/{pid}/render").status_code == 409
    gate.set()
    assert _wait(client, pid)["state"] == "done"
