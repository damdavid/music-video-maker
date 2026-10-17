import threading

from fastapi.testclient import TestClient

from app import main
from tests.client import make_client


def test_project_flow(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "PROJECTS_DIR", tmp_path)
    client = make_client()

    created = client.post("/projects", files={"audio": ("a.mp3", b"audio")}, data={"lyrics_text": "la la"})
    assert created.status_code == 200
    assert created.json()["lyrics_text"] == "la la"
    pid = created.json()["id"]

    assert client.get(f"/projects/{pid}/analysis").status_code == 404
    assert client.get(f"/projects/{pid}/audio").content == b"audio"
    assert client.get("/projects/../etc").status_code == 404
    assert not list(tmp_path.rglob("*.tmp"))  # atomic writes leave no temp files behind


def test_heavy_work_only_runs_as_a_background_job(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "PROJECTS_DIR", tmp_path)
    client = make_client()
    pid = client.post("/projects", files={"audio": ("a.mp3", b"x")}).json()["id"]
    # The synchronous routes skipped the one-heavy-job rule; /process replaces them.
    assert client.post(f"/projects/{pid}/analyze").status_code in (404, 405)
    assert client.post(f"/projects/{pid}/align").status_code in (404, 405)


def test_lyrics_routes(tmp_path, monkeypatch):
    from app.models import Line, Lyrics, Word

    monkeypatch.setattr(main, "PROJECTS_DIR", tmp_path)
    fake = Lyrics(lines=[Line(start=1.0, end=2.0, text="hi there", words=[Word(start=1.0, end=1.4, text="hi"), Word(start=1.4, end=2.0, text="there")])])
    client = make_client()

    pid = client.post("/projects", files={"audio": ("a.mp3", b"x")}, data={"lyrics_text": "hi there"}).json()["id"]
    assert client.get(f"/projects/{pid}/lyrics").status_code == 404
    assert client.put(f"/projects/{pid}/lyrics", json=fake.model_dump()).json()["lines"][0]["text"] == "hi there"

    assert client.get(f"/projects/{pid}/lyrics.lrc?enhanced=true").text == "[00:01.00]<00:01.00>hi <00:01.40>there <00:02.00>\n"
    imported = client.post(f"/projects/{pid}/lyrics/import-lrc", content="[00:05.00]new line\n", headers={"content-type": "text/plain"})
    assert imported.json()["lines"][0]["start"] == 5.0
    assert client.get(f"/projects/{pid}/lyrics").json()["lines"][0]["text"] == "new line"


def test_project_list_and_lyrics_text(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "PROJECTS_DIR", tmp_path)
    (tmp_path / "stray").mkdir()  # no project.json: skipped
    (tmp_path / "bad").mkdir()
    (tmp_path / "bad" / "project.json").write_text("{nope")
    client = make_client()
    assert client.get("/projects").json() == []

    a = client.post("/projects", files={"audio": ("a.mp3", b"x")}).json()["id"]
    b = client.post("/projects", files={"audio": ("a.mp3", b"x")}).json()["id"]
    client.put(f"/projects/{a}/meta", json={"title": "First", "artist": "Me"})
    (tmp_path / a / "analysis.json").write_text("{}")
    import os, time

    os.utime(tmp_path / a / "project.json", (time.time() + 10, time.time() + 10))  # a is newest
    listed = client.get("/projects").json()
    assert [p["id"] for p in listed] == [a, b]
    assert listed[0]["title"] == "First" and listed[0]["has_analysis"] is True and listed[0]["has_plan"] is False

    updated = client.put(f"/projects/{b}/lyrics-text", content="new words\nline two", headers={"content-type": "text/plain"})
    assert updated.json()["lyrics_text"] == "new words\nline two"
    assert client.get(f"/projects/{b}").json()["lyrics_text"] == "new words\nline two"


def test_mutations_require_the_client_header(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "PROJECTS_DIR", tmp_path)
    pid = make_client().post("/projects", files={"audio": ("a.mp3", b"x")}).json()["id"]
    bare = TestClient(main.app, base_url="http://localhost")
    assert bare.get(f"/projects/{pid}").status_code == 200  # reads (audio for the renderer, downloads) need no header
    for method, url in (("POST", "/projects"), ("PUT", f"/projects/{pid}/meta"), ("DELETE", f"/projects/{pid}/recent")):
        res = bare.request(method, url, json={})
        assert res.status_code == 403 and "X-MVM-Client" in res.json()["detail"]
    assert bare.put(f"/projects/{pid}/meta", json={"title": "x"}, headers={"X-MVM-Client": "evil"}).status_code == 403
    assert make_client().get(f"/projects/{pid}").json()["meta"]["title"] == ""


def test_only_loopback_hosts_are_served(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "PROJECTS_DIR", tmp_path)
    headers = {"X-MVM-Client": "web"}
    assert TestClient(main.app, base_url="http://evil.example", headers=headers).get("/projects").status_code == 400
    assert TestClient(main.app, headers=headers).get("/projects").status_code == 400  # TestClient's own "testserver" too
    for host in ("localhost:5173", "127.0.0.1:8000", "localhost"):  # the Vite proxy keeps the browser's Host
        assert make_client().get("/projects", headers={"host": host}).status_code == 200


def test_concurrent_edits_to_different_fields_are_all_kept(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "PROJECTS_DIR", tmp_path)
    client = make_client()
    pid = client.post("/projects", files={"audio": ("a.mp3", b"x")}).json()["id"]
    real_load = main._load

    def slow_load(project_id):
        project = real_load(project_id)
        threading.Event().wait(0.05)  # widen the read-modify-write window
        return project

    monkeypatch.setattr(main, "_load", slow_load)
    threads = [
        threading.Thread(target=lambda: client.put(f"/projects/{pid}/meta", json={"title": "T"})),
        threading.Thread(target=lambda: client.put(f"/projects/{pid}/section-descriptions", json=["rain"])),
        threading.Thread(target=lambda: client.put(f"/projects/{pid}/lyrics-text", content="words", headers={"content-type": "text/plain"})),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    got = client.get(f"/projects/{pid}").json()
    assert (got["meta"]["title"], got["section_descriptions"], got["lyrics_text"]) == ("T", ["rain"], "words")
