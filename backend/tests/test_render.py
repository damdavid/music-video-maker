import json
import sys
import time

import pytest

from app import main, render
from app.models import AnalysisData, Line, Lyrics, Meta, Project, Section, Settings, StylePlan
from tests.client import make_client

FAKE_OK = """
import json, sys
a = sys.argv
out = a[a.index("--out") + 1]
props = json.load(open(a[a.index("--props") + 1]))
print(json.dumps({"type": "stage", "stage": "bundling", "progress": 0.05}), flush=True)
print("some stray log line", flush=True)
print(json.dumps({"type": "stage", "stage": "rendering", "progress": 0.5}), flush=True)
open(out, "wb").write(json.dumps({"seconds": a[a.index("--seconds") + 1] if "--seconds" in a else None, "lyrics": props["lyrics"] is not None}).encode())
print(json.dumps({"type": "done", "out": out, "width": 1920, "height": 1080, "fps": 30}), flush=True)
"""

FAKE_FAIL = 'import json; print(json.dumps({"type": "error", "message": "Chrome exploded"}), flush=True); raise SystemExit(1)'
FAKE_CRASH = 'import sys; sys.stderr.write("Traceback: boom\\n"); raise SystemExit(3)'


def _analysis() -> AnalysisData:
    flat = [0.5] * 60
    return AnalysisData(
        duration=2.0, bpm=120, key="C major", beats=[], downbeats=[], onsets=[], sections=[Section(start=0, end=2, label="s")],
        rms=flat, low=flat, mid=flat, high=flat, spectral_centroid=flat, onset_strength=flat, chroma=[[0.0] * 12] * 60,
    )


def _wait(client, pid, timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        st = client.get(f"/projects/{pid}/render").json()
        if st["state"] in ("done", "error"):
            return st
        time.sleep(0.05)
    raise AssertionError("render did not finish")


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "PROJECTS_DIR", tmp_path)
    render.JOBS.clear()
    client = make_client()
    pid = client.post("/projects", files={"audio": ("a.mp3", b"x")}, data={"lyrics_text": "la"}).json()["id"]
    (tmp_path / pid / "analysis.json").write_text(_analysis().model_dump_json())
    return client, pid, tmp_path


def _use_script(monkeypatch, tmp_path, source):
    script = tmp_path / "fake_render.py"
    script.write_text(source)
    monkeypatch.setattr(render, "render_command", lambda props, out, seconds: [sys.executable, str(script), "--props", str(props), "--out", str(out)] + (["--seconds", str(seconds)] if seconds else []))


def test_build_props_respects_lyric_toggle_and_audio_url():
    lyrics = Lyrics(lines=[Line(start=0, end=1, text="hi")])
    on = render.build_props(Project(id="p", settings=Settings(lyric_video=True)), _analysis(), lyrics, None)
    off = render.build_props(Project(id="p", settings=Settings(lyric_video=False)), _analysis(), lyrics, None)
    assert on["lyrics"]["lines"][0]["text"] == "hi" and off["lyrics"] is None
    assert on["audioSrc"].endswith("/projects/p/audio") and on["plan"] is None
    plan = StylePlan.model_validate({"global": {"palette": ["#000000", "#ffffff"], "font_family": "Inter", "typography_style": "bold", "background_preset": "tunnel"}, "sections": []})
    assert render.build_props(Project(id="p"), _analysis(), None, plan)["plan"]["global"]["background_preset"] == "tunnel"


def test_render_flow_reports_progress_and_serves_file(api, monkeypatch):
    client, pid, tmp = api
    _use_script(monkeypatch, tmp, FAKE_OK)
    assert client.get(f"/projects/{pid}/render").status_code == 404
    assert client.get(f"/projects/{pid}/render/video").status_code == 404

    started = client.post(f"/projects/{pid}/render")
    assert started.status_code == 202 and started.json()["clip"] is False
    final = _wait(client, pid)
    assert final["state"] == "done" and final["progress"] == 1 and (final["width"], final["height"], final["fps"]) == (1920, 1080, 30)

    video = client.get(f"/projects/{pid}/render/video")
    assert video.status_code == 200 and video.headers["content-type"] == "video/mp4"
    assert json.loads(video.content)["seconds"] is None
    assert not list((tmp / pid / "out").glob(".props-*"))  # props file removed


def test_clip_render_passes_seconds_and_uses_separate_file(api, monkeypatch):
    client, pid, tmp = api
    _use_script(monkeypatch, tmp, FAKE_OK)
    assert client.post(f"/projects/{pid}/render?seconds=15").json()["clip"] is True
    _wait(client, pid)
    assert json.loads(client.get(f"/projects/{pid}/render/video?clip=true").content)["seconds"] == "15.0"
    assert client.get(f"/projects/{pid}/render/video").status_code == 404  # full video untouched
    assert client.post(f"/projects/{pid}/render?seconds=0").status_code == 422


def test_renderer_error_message_is_surfaced(api, monkeypatch):
    client, pid, tmp = api
    _use_script(monkeypatch, tmp, FAKE_FAIL)
    client.post(f"/projects/{pid}/render")
    final = _wait(client, pid)
    assert final["state"] == "error" and final["error"] == "Chrome exploded"


def test_crash_without_protocol_message_reports_exit_code_and_stderr(api, monkeypatch):
    client, pid, tmp = api
    _use_script(monkeypatch, tmp, FAKE_CRASH)
    client.post(f"/projects/{pid}/render")
    final = _wait(client, pid)
    assert final["state"] == "error" and "code 3" in final["error"] and "boom" in final["error"]


def test_second_render_is_rejected_while_one_is_active(api, monkeypatch):
    client, pid, tmp = api
    _use_script(monkeypatch, tmp, "import time; time.sleep(1.5)")
    assert client.post(f"/projects/{pid}/render").status_code == 202
    assert client.post(f"/projects/{pid}/render").status_code == 409
    _wait(client, pid)  # exits without a done event -> error, freeing the slot
    assert client.post(f"/projects/{pid}/render").status_code == 202
    _wait(client, pid)


def test_render_requires_analysis(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "PROJECTS_DIR", tmp_path)
    client = make_client()
    pid = client.post("/projects", files={"audio": ("a.mp3", b"x")}).json()["id"]
    assert client.post(f"/projects/{pid}/render").status_code == 409


FAKE_ODD_LINES = """
import json, sys
a = sys.argv
out = a[a.index("--out") + 1]
for line in ("42", "null", "[1, 2]", '"text"', json.dumps({"type": "stage", "stage": "rendering", "progress": None})):
    print(line, flush=True)
open(out, "wb").write(b"ok")
print(json.dumps({"type": "done", "width": 1, "height": 1, "fps": 30}), flush=True)
"""


def test_valid_json_that_is_not_an_event_is_ignored(api, monkeypatch):
    client, pid, tmp = api
    _use_script(monkeypatch, tmp, FAKE_ODD_LINES)
    client.post(f"/projects/{pid}/render")
    final = _wait(client, pid)
    assert final["state"] == "done", final


def test_an_unexpected_failure_kills_the_renderer(api, monkeypatch):
    import os

    client, pid, tmp = api
    pid_file = tmp / "child.pid"
    _use_script(monkeypatch, tmp, f'import json, os, time; open({str(pid_file)!r}, "w").write(str(os.getpid())); print(json.dumps({{"type": "stage", "stage": "bundling", "progress": 0.1}}), flush=True); time.sleep(30)')

    def explode(job, event):
        raise RuntimeError("bug in the progress parser")

    monkeypatch.setattr(render, "_apply", explode)
    client.post(f"/projects/{pid}/render")
    final = _wait(client, pid)
    assert final["state"] == "error" and "bug in the progress parser" in final["error"]
    child = int(pid_file.read_text())
    end = time.time() + 5
    while time.time() < end:
        try:
            os.kill(child, 0)
        except ProcessLookupError:
            return
        time.sleep(0.05)
    raise AssertionError("renderer still running")
