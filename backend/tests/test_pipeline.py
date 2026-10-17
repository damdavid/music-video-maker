import time

import pytest

from app import jobs, main, pipeline, render
from app.models import AnalysisData, Line, Lyrics, Project, Section, Settings
from tests.client import make_client


def _analysis() -> AnalysisData:
    flat = [0.5] * 30
    return AnalysisData(
        duration=1.0, bpm=120, key="C major", beats=[], downbeats=[], onsets=[], sections=[Section(start=0, end=1, label="s")],
        rms=flat, low=flat, mid=flat, high=flat, spectral_centroid=flat, onset_strength=flat, chroma=[[0.0] * 12] * 30,
    )


@pytest.fixture
def fakes(tmp_path, monkeypatch):
    """Replaces the heavy steps; records the order they ran in and the progress the job reported."""
    calls, seen = [], []
    jobs.JOBS.clear()
    render.JOBS.clear()

    def fake_isolate(src, out, on_progress=None):
        calls.append("separate")
        for frac in (0.0, 0.5, 1.0):
            on_progress(frac)
        out.write_bytes(b"v")

    monkeypatch.setattr(pipeline, "analyze", lambda p: calls.append("analyze") or _analysis())
    monkeypatch.setattr(pipeline, "isolate_vocals", fake_isolate)
    monkeypatch.setattr(pipeline, "align", lambda a, t: calls.append("align") or Lyrics(lines=[Line(start=0, end=1, text=t)]))
    return calls, seen


def _job(monkeypatch=None):
    job = jobs.ProcessJob(project_id="p")
    reports = []
    original = job.report
    job.report = lambda stage, progress: (reports.append((stage, round(progress, 3))), original(stage, progress))[1]
    return job, reports


def test_full_pipeline_orders_stages_and_progress_never_decreases(tmp_path, fakes):
    calls, _ = fakes
    job, reports = _job()
    pipeline.run(tmp_path, Project(id="p", lyrics_text="hello"), job)
    assert calls == ["analyze", "separate", "align"]
    assert (tmp_path / "analysis.json").exists() and (tmp_path / "lyrics.json").exists()
    stages = [s for s, _ in reports]
    assert stages[0] == "analyzing" and stages[-1] == "aligning lyrics" and "separating vocals" in stages
    fractions = [f for _, f in reports]
    assert fractions == sorted(fractions) and 0 < fractions[0] and fractions[-1] < 1


def test_skips_alignment_without_lyrics_or_when_lyric_video_is_off(tmp_path, fakes):
    calls, _ = fakes
    pipeline.run(tmp_path, Project(id="p", lyrics_text="   "), _job()[0])
    pipeline.run(tmp_path, Project(id="p", lyrics_text="words", settings=Settings(lyric_video=False)), _job()[0])
    assert calls == ["analyze", "analyze"]
    assert not (tmp_path / "lyrics.json").exists()


def test_existing_vocals_stem_is_reused(tmp_path, fakes):
    calls, _ = fakes
    (tmp_path / "vocals.wav").write_bytes(b"already")
    pipeline.run(tmp_path, Project(id="p", lyrics_text="hi"), _job()[0])
    assert calls == ["analyze", "align"]


def test_process_routes_report_done_and_expose_results(tmp_path, monkeypatch, fakes):
    monkeypatch.setattr(main, "PROJECTS_DIR", tmp_path)
    client = make_client()
    pid = client.post("/projects", files={"audio": ("a.mp3", b"x")}, data={"lyrics_text": "hello"}).json()["id"]
    assert client.get(f"/projects/{pid}/process").status_code == 404

    assert client.post(f"/projects/{pid}/process").status_code == 202
    for _ in range(100):
        status = client.get(f"/projects/{pid}/process").json()
        if status["state"] in ("done", "error"):
            break
        time.sleep(0.05)
    assert status["state"] == "done" and status["progress"] == 1
    assert client.get(f"/projects/{pid}/analysis").status_code == 200
    assert client.get(f"/projects/{pid}/lyrics").json()["lines"][0]["text"] == "hello"


def test_pipeline_error_is_reported_not_swallowed(tmp_path, monkeypatch, fakes):
    monkeypatch.setattr(main, "PROJECTS_DIR", tmp_path)
    monkeypatch.setattr(pipeline, "analyze", lambda p: (_ for _ in ()).throw(RuntimeError("bad audio")))
    client = make_client()
    pid = client.post("/projects", files={"audio": ("a.mp3", b"x")}).json()["id"]
    client.post(f"/projects/{pid}/process")
    for _ in range(100):
        status = client.get(f"/projects/{pid}/process").json()
        if status["state"] in ("done", "error"):
            break
        time.sleep(0.05)
    assert status["state"] == "error" and "bad audio" in status["error"]


def test_process_and_render_exclude_each_other(tmp_path, monkeypatch, fakes):
    monkeypatch.setattr(main, "PROJECTS_DIR", tmp_path)
    client = make_client()
    pid = client.post("/projects", files={"audio": ("a.mp3", b"x")}).json()["id"]
    (tmp_path / pid / "analysis.json").write_text(_analysis().model_dump_json())

    release = __import__("threading").Event()
    monkeypatch.setattr(pipeline, "analyze", lambda p: release.wait(5) and _analysis())
    assert client.post(f"/projects/{pid}/process").status_code == 202
    assert client.post(f"/projects/{pid}/process").status_code == 409
    assert client.post(f"/projects/{pid}/render").status_code == 409  # render blocked while processing
    release.set()
    for _ in range(100):
        if client.get(f"/projects/{pid}/process").json()["state"] == "done":
            break
        time.sleep(0.05)
    assert client.get(f"/projects/{pid}/process").json()["state"] == "done"
