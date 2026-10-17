import io
import json
import zipfile

import pytest

from app import main, projects_store
from tests.client import make_client


@pytest.fixture
def api(tmp_path, monkeypatch):
    root = tmp_path / "root"
    root.mkdir()
    monkeypatch.setattr(main, "PROJECTS_DIR", root)
    return make_client(), root, tmp_path


def _create(client, location=None, name="song.mp3"):
    data = {"location": str(location)} if location else {}
    r = client.post("/projects", files={"audio": (name, b"audio-bytes")}, data=data)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_create_in_chosen_location_registers_and_lists(api):
    client, root, tmp = api
    elsewhere = tmp / "elsewhere"
    elsewhere.mkdir()
    pid = _create(client, elsewhere)
    folder = projects_store.resolve(root, pid)
    assert folder.parent == elsewhere and folder.name == f"song-{pid}"
    assert (folder / "audio.mp3").read_bytes() == b"audio-bytes"
    assert client.put(f"/projects/{pid}/meta", json={"title": "T"}).status_code == 200
    assert json.loads((folder / "project.json").read_text())["meta"]["title"] == "T"  # saves land in the chosen folder
    (summary,) = client.get("/projects").json()
    assert summary["path"] == str(folder) and not summary["missing"]


def test_default_location_still_works_and_missing_folder_is_flagged(api):
    client, root, tmp = api
    pid = _create(client)
    assert (root / pid / "project.json").is_file()
    elsewhere = tmp / "gone"
    elsewhere.mkdir()
    gone = _create(client, elsewhere)
    import shutil

    shutil.rmtree(projects_store.resolve(root, gone))
    by_id = {p["id"]: p for p in client.get("/projects").json()}
    assert by_id[gone]["missing"] and not by_id[pid]["missing"]
    assert client.get(f"/projects/{gone}").status_code == 404


def test_create_rejects_a_bad_location(api):
    client, _, tmp = api
    r = client.post("/projects", files={"audio": ("a.mp3", b"x")}, data={"location": str(tmp / "nope")})
    assert r.status_code == 422


def test_forget_keeps_files_and_open_registers_again(api):
    client, root, tmp = api
    elsewhere = tmp / "e"
    elsewhere.mkdir()
    pid = _create(client, elsewhere)
    folder = projects_store.resolve(root, pid)
    assert client.delete(f"/projects/{pid}/recent").status_code == 204
    assert client.get("/projects").json() == [] and folder.is_dir()
    reopened = client.post("/projects/open", json={"path": str(folder)}).json()
    assert reopened["id"] == pid and len(client.get("/projects").json()) == 1


def test_open_gives_a_new_id_when_the_id_is_taken_elsewhere(api):
    client, root, tmp = api
    pid = _create(client)
    copy = tmp / "copied"
    import shutil

    shutil.copytree(root / pid, copy)
    opened = client.post("/projects/open", json={"path": str(copy)}).json()
    assert opened["id"] != pid
    assert json.loads((copy / "project.json").read_text())["id"] == opened["id"]
    assert len(client.get("/projects").json()) == 2


def test_open_rejects_non_projects(api):
    client, _, tmp = api
    (tmp / "plain").mkdir()
    assert client.post("/projects/open", json={"path": str(tmp / "plain")}).status_code == 422
    assert client.post("/projects/open", json={"path": "relative/path"}).status_code == 422


def test_save_as_copies_without_renders_under_a_new_id(api):
    client, root, tmp = api
    pid = _create(client)
    out = root / pid / "out"
    out.mkdir()
    (out / "video.mp4").write_bytes(b"big")
    dest = tmp / "dest"
    dest.mkdir()
    copy = client.post(f"/projects/{pid}/save-as", json={"location": str(dest), "name": "My Song"}).json()
    assert copy["id"] != pid
    folder = projects_store.resolve(root, copy["id"])
    assert folder.parent == dest and folder.name.startswith("my-song-")
    assert (folder / "audio.mp3").is_file() and not (folder / "out").exists()
    assert (root / pid / "out" / "video.mp4").is_file()


def test_export_import_round_trip(api):
    client, root, tmp = api
    pid = _create(client)
    client.put(f"/projects/{pid}/meta", json={"title": "Round Trip"})
    client.put(f"/projects/{pid}/section-descriptions", json=["rain", "sun"])
    (root / pid / "out").mkdir()
    (root / pid / "out" / "video.mp4").write_bytes(b"big")
    r = client.get(f"/projects/{pid}/export")
    assert r.status_code == 200 and "round-trip.mvm" in r.headers["content-disposition"]
    names = zipfile.ZipFile(io.BytesIO(r.content)).namelist()
    assert "manifest.json" in names and "audio.mp3" in names and not any("out" in n for n in names)

    dest = tmp / "imported"
    dest.mkdir()
    imported = client.post("/projects/import", files={"bundle": ("x.mvm", r.content)}, data={"location": str(dest)})
    assert imported.status_code == 200, imported.text
    got = imported.json()
    assert got["id"] != pid and got["meta"]["title"] == "Round Trip" and got["section_descriptions"] == ["rain", "sun"]
    assert (projects_store.resolve(root, got["id"]) / "audio.mp3").read_bytes() == b"audio-bytes"


def _zip(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in files.items():
            z.writestr(name, data)
    return buf.getvalue()


def test_import_rejects_bad_bundles_and_ignores_unknown_names(api):
    client, root, tmp = api
    manifest = json.dumps({"format": "mvm", "version": 1}).encode()
    project = json.dumps({"id": "abc"}).encode()
    for bad in (b"not a zip", _zip({"project.json": project}), _zip({"manifest.json": b'{"format":"x","version":1}', "project.json": project}), _zip({"manifest.json": manifest})):
        assert client.post("/projects/import", files={"bundle": ("x.mvm", bad)}).status_code == 422
    sneaky = _zip({"manifest.json": manifest, "project.json": project, "../evil.txt": b"x", "notes/evil.py": b"x"})
    r = client.post("/projects/import", files={"bundle": ("x.mvm", sneaky)})
    assert r.status_code == 200
    folder = projects_store.resolve(root, r.json()["id"])
    assert sorted(p.name for p in folder.iterdir()) == ["project.json"]
    assert not (root / "evil.txt").exists() and not (root.parent / "evil.txt").exists()


def test_folder_browser(api):
    client, _, tmp = api
    (tmp / "a").mkdir()
    (tmp / ".hidden").mkdir()
    (tmp / "proj").mkdir()
    (tmp / "proj" / "project.json").write_text("{}")
    (tmp / "file.txt").write_text("x")
    listing = client.get("/fs/list", params={"path": str(tmp)}).json()
    assert listing["path"] == str(tmp.resolve()) and listing["parent"]
    assert {d["name"]: d["is_project"] for d in listing["dirs"] if d["name"] in ("a", "proj", ".hidden", "file.txt")} == {"a": False, "proj": True}
    assert client.get("/fs/list").json()["path"] == listing["home"]
    assert client.get("/fs/list", params={"path": str(tmp / "nope")}).status_code == 422
    assert client.post("/fs/mkdir", json={"path": str(tmp / "new")}).status_code == 200 and (tmp / "new").is_dir()
    assert client.post("/fs/mkdir", json={"path": str(tmp / "new")}).status_code == 409
    assert client.post("/fs/mkdir", json={"path": str(tmp / "x" / "y")}).status_code == 422


def test_import_rejects_an_invalid_project_without_leaving_anything_behind(api):
    client, root, tmp = api
    manifest = json.dumps({"format": "mvm", "version": 1}).encode()
    dest = tmp / "dest"
    dest.mkdir()
    bad_projects = (b'"nope"', b"[]", b"{nope", json.dumps({"id": "abc", "settings": {"aspect": "4:3"}}).encode())
    for project in bad_projects:
        for data in ({}, {"location": str(dest)}):
            r = client.post("/projects/import", files={"bundle": ("x.mvm", _zip({"manifest.json": manifest, "project.json": project, "audio.mp3": b"a"}))}, data=data)
            assert r.status_code == 422 and "project.json" in r.json()["detail"], r.text
    assert client.post("/projects/import", files={"bundle": ("x.mvm", _zip({"manifest.json": b"[]", "project.json": b"{}"}))}).status_code == 422
    assert projects_store.registry(root) == {} and client.get("/projects").json() == []
    assert list(dest.iterdir()) == [] and [p.name for p in root.iterdir()] == []


def test_import_turns_corrupt_zip_data_into_a_422(api):
    client, root, _ = api
    manifest = json.dumps({"format": "mvm", "version": 1}).encode()
    good = _zip({"manifest.json": manifest, "project.json": json.dumps({"id": "abc"}).encode(), "audio.mp3": b"A" * 4000})
    offset = good.index(b"A" * 100)
    corrupt = good[:offset] + b"B" * 100 + good[offset + 100 :]  # stored entry with a bad CRC
    r = client.post("/projects/import", files={"bundle": ("x.mvm", corrupt)})
    assert r.status_code == 422 and "readable" in r.json()["detail"]
    assert projects_store.registry(root) == {} and list(root.iterdir()) == []


def test_write_atomic_replaces_whole_files_and_cleans_up_on_failure(tmp_path, monkeypatch):
    target = tmp_path / "project.json"
    target.write_text("old")
    projects_store.write_atomic(target, "new")
    assert target.read_text() == "new"

    def broken_replace(src, dst):
        raise OSError("disk full")

    monkeypatch.setattr(projects_store.os, "replace", broken_replace)
    with pytest.raises(OSError):
        projects_store.write_atomic(target, "half")
    assert target.read_text() == "new" and [p.name for p in tmp_path.iterdir()] == ["project.json"]


def test_folder_browser_reports_permission_problems(api, monkeypatch):
    from pathlib import Path

    client, _, tmp = api
    locked = tmp / "locked"
    locked.mkdir()

    def denied(self, *a, **kw):
        raise PermissionError(13, "Permission denied", str(self))

    monkeypatch.setattr(Path, "iterdir", denied)
    r = client.get("/fs/list", params={"path": str(locked)})
    assert r.status_code == 403 and "permission" in r.json()["detail"]
    monkeypatch.setattr(Path, "mkdir", denied)
    r = client.post("/fs/mkdir", json={"path": str(locked / "new")})
    assert r.status_code == 403 and "permission" in r.json()["detail"]

    def readonly(self, *a, **kw):
        raise OSError(30, "Read-only file system", str(self))

    monkeypatch.setattr(Path, "mkdir", readonly)
    r = client.post("/fs/mkdir", json={"path": str(locked / "new")})
    assert r.status_code == 422 and "Read-only" in r.json()["detail"]
