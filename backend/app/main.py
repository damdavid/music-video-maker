import shutil
import tempfile
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import TypeVar
from urllib.parse import urlparse

import anthropic
from fastapi import Body, Depends, FastAPI, Form, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

from app import illustrate, jobs, lrc, pipeline, projects_store, render
from app.models import AnalysisData, Lyrics, Meta, ProcessStatus, Project, ProjectSummary, RenderStatus, Scene, Settings, Storyboard, StylePlan, StyleSection
from app.projects_store import write_atomic
from app.storyboard import generate_storyboard, regenerate_scene
from app.style_plan import StyleError, generate_plan, regenerate_section

PROJECTS_DIR = Path(__file__).resolve().parents[2] / "projects"
# Loopback names only, so a DNS-rebinding page can't reach the API under its own hostname.
ALLOWED_HOSTS = sorted({"localhost", "127.0.0.1", "[::1]", urlparse(render.BACKEND_URL).hostname or "127.0.0.1"})
CLIENT_HEADER = "x-mvm-client"
MUTATING = {"POST", "PUT", "PATCH", "DELETE"}

M = TypeVar("M", bound=BaseModel)


def claude_client(x_anthropic_key: str = Header("")) -> anthropic.Anthropic:
    """Each user brings their own API key; an explicit key also stops the SDK from falling back to the machine's credentials."""
    key = x_anthropic_key.strip()
    if not key:
        raise HTTPException(401, "add your Anthropic API key (Claude API key, top right) to use Claude")
    return anthropic.Anthropic(api_key=key)


@contextmanager
def claude_errors(what: str) -> Iterator[None]:
    try:
        yield
    except anthropic.AuthenticationError as e:
        raise HTTPException(401, "Anthropic rejected your API key; check it under Claude API key, top right") from e
    except (StyleError, anthropic.AnthropicError) as e:
        raise HTTPException(502, f"{what} failed: {e}") from e


class RequireClientHeader:
    """Mutations must carry X-MVM-Client: web; a custom header forces a CORS preflight, so other sites can't post forms here."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] in MUTATING and Headers(scope=scope).get(CLIENT_HEADER) != "web":
            await JSONResponse({"detail": "missing X-MVM-Client: web header"}, status_code=403)(scope, receive, send)
            return
        await self.app(scope, receive, send)


app = FastAPI(title="music-video-maker")
app.add_middleware(RequireClientHeader)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)


def _dir(project_id: str) -> Path:
    # Ids are server-generated hex; reject anything else so a request can't name an arbitrary path.
    if not project_id.isalnum():
        raise HTTPException(404)
    d = projects_store.resolve(PROJECTS_DIR, project_id)
    if not d.is_dir():
        raise HTTPException(404)
    return d


def _load(project_id: str) -> Project:
    return Project.model_validate_json((_dir(project_id) / "project.json").read_text())


def _save(project: Project) -> None:
    write_atomic(_dir(project.id) / "project.json", project.model_dump_json(indent=2))


_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


@contextmanager
def _editing(project_id: str) -> Iterator[Project]:
    """Loads, yields and saves project.json; edits to different fields arrive concurrently and must not drop each other."""
    with _locks_guard:
        lock = _locks.setdefault(project_id, threading.Lock())
    with lock:
        project = _load(project_id)
        yield project
        _save(project)


def _read(project_id: str, name: str, model: type[M]) -> M | None:
    path = _dir(project_id) / name
    return model.model_validate_json(path.read_text()) if path.exists() else None


def _write(project_id: str, name: str, data: BaseModel, by_alias: bool = False) -> None:
    write_atomic(_dir(project_id) / name, data.model_dump_json(by_alias=by_alias))


def _folder(path: str) -> Path:
    p = Path(path).expanduser()
    if not p.is_absolute() or not p.is_dir():
        raise HTTPException(422, f"not a folder: {path}")
    return p.resolve()


def _create_in(parent: Path, project: Project, name: str) -> Path:
    d = projects_store.project_folder(parent, name, project.id)
    if d.exists():
        raise HTTPException(409, f"{d} already exists")
    return d


@app.post("/projects")
async def create_project(audio: UploadFile, lyrics_text: str = Form(""), location: str = Form("")) -> Project:
    project = Project(id=projects_store.new_id(), lyrics_text=lyrics_text)
    if location.strip():
        d = _create_in(_folder(location), project, Path(audio.filename or "").stem)
    else:
        d = PROJECTS_DIR / project.id
    d.mkdir(parents=True)
    projects_store.register(PROJECTS_DIR, project.id, d)
    write_atomic(d / "audio.mp3", await audio.read())
    _save(project)
    return project


@app.get("/projects")
def list_projects() -> list[ProjectSummary]:
    """Newest first. Folders without a readable project.json are skipped; registered folders that went missing are flagged."""
    out = []
    for project_id in projects_store.known_ids(PROJECTS_DIR):
        d = projects_store.resolve(PROJECTS_DIR, project_id)
        meta_file = d / "project.json"
        if not d.is_dir():
            out.append(ProjectSummary(id=project_id, title=d.name, artist="", modified=0, has_analysis=False, has_lyrics=False, has_plan=False, has_video=False, path=str(d), missing=True))
            continue
        try:
            project = Project.model_validate_json(meta_file.read_text())
        except (OSError, ValueError):
            continue
        out.append(
            ProjectSummary(
                id=project_id,
                title=project.meta.title,
                artist=project.meta.artist,
                modified=max(f.stat().st_mtime for f in d.iterdir() if f.is_file() and not f.name.startswith(".")),
                has_analysis=(d / "analysis.json").exists(),
                has_lyrics=(d / "lyrics.json").exists(),
                has_plan=(d / "style_plan.json").exists(),
                has_video=(d / "out" / "video.mp4").exists(),
                path=str(d),
            )
        )
    return sorted(out, key=lambda p: p.modified, reverse=True)


class OpenRequest(BaseModel):
    path: str


class SaveAsRequest(BaseModel):
    location: str
    name: str = ""


class MkdirRequest(BaseModel):
    path: str


@app.post("/projects/open")
def open_project(req: OpenRequest) -> Project:
    """Registers an existing project folder from anywhere on disk. A folder whose id is already in use elsewhere gets a new id."""
    d = _folder(req.path)
    try:
        project = Project.model_validate_json((d / "project.json").read_text())
    except (OSError, ValueError) as e:
        raise HTTPException(422, f"{d} is not a project folder (no readable project.json)") from e
    taken = projects_store.resolve(PROJECTS_DIR, project.id)
    if not project.id.isalnum() or (taken.exists() and taken.resolve() != d):
        project.id = projects_store.new_id()
        write_atomic(d / "project.json", project.model_dump_json(indent=2))
    projects_store.register(PROJECTS_DIR, project.id, d)
    return project


@app.post("/projects/{project_id}/save-as")
def save_project_as(project_id: str, req: SaveAsRequest) -> Project:
    """Copies the project (without renders) into a new folder under a new id and returns the copy."""
    src = _dir(project_id)
    project = _load(project_id)
    copy = project.model_copy(update={"id": projects_store.new_id()})
    dest = _create_in(_folder(req.location), copy, req.name or project.meta.title or "project")
    projects_store.copy_project(src, dest, copy.id)
    projects_store.register(PROJECTS_DIR, copy.id, dest)
    return copy


@app.delete("/projects/{project_id}/recent", status_code=204)
def forget_project(project_id: str) -> None:
    """Drops the project from the list without touching its files."""
    projects_store.unregister(PROJECTS_DIR, project_id)


@app.get("/projects/{project_id}/export")
def export_project(project_id: str) -> FileResponse:
    d = _dir(project_id)
    project = _load(project_id)
    tmp = Path(tempfile.mkdtemp()) / "project.mvm"
    projects_store.write_bundle(d, tmp)
    name = projects_store.slug(project.meta.title or project_id)
    return FileResponse(tmp, media_type="application/zip", filename=f"{name}.mvm", background=BackgroundTask(shutil.rmtree, tmp.parent, True))


@app.post("/projects/import")
async def import_project(bundle: UploadFile, location: str = Form("")) -> Project:
    parent = _folder(location) if location.strip() else PROJECTS_DIR
    tmp_dir = Path(tempfile.mkdtemp())
    try:
        upload = tmp_dir / "in.mvm"
        upload.write_bytes(await bundle.read())
        project_id = projects_store.new_id()
        dest = projects_store.project_folder(parent, Path(bundle.filename or "").stem, project_id) if location.strip() else PROJECTS_DIR / project_id
        try:
            projects_store.read_bundle(upload, dest, project_id)
        except projects_store.BundleError as e:
            raise HTTPException(422, str(e)) from e
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
    projects_store.register(PROJECTS_DIR, project_id, dest)
    return _load(project_id)


@app.get("/fs/list")
def list_folder(path: str = "") -> dict:
    """Directories only, for the in-app folder browser. Dotfolders are hidden."""
    home = Path.home()
    d = _folder(path) if path else home
    try:
        children = sorted(d.iterdir(), key=lambda c: c.name.lower())
    except PermissionError as e:
        raise HTTPException(403, f"no permission to read {d}") from e
    except OSError as e:
        raise HTTPException(422, f"can't read {d}: {e.strerror or e}") from e
    dirs = []
    for child in children:
        try:
            if child.is_dir() and not child.name.startswith("."):
                dirs.append({"name": child.name, "is_project": (child / "project.json").is_file()})
        except OSError:
            continue
    return {"path": str(d), "parent": str(d.parent) if d.parent != d else None, "home": str(home), "is_project": (d / "project.json").is_file(), "dirs": dirs}


@app.post("/fs/mkdir")
def make_folder(req: MkdirRequest) -> dict:
    p = Path(req.path).expanduser()
    if not p.is_absolute() or not p.parent.is_dir():
        raise HTTPException(422, f"parent folder doesn't exist: {req.path}")
    try:
        p.mkdir()
    except FileExistsError as e:
        raise HTTPException(409, f"{p} already exists") from e
    except PermissionError as e:
        raise HTTPException(403, f"no permission to create {p}") from e
    except OSError as e:
        raise HTTPException(422, f"can't create {p}: {e.strerror or e}") from e
    return {"path": str(p)}


@app.get("/projects/{project_id}")
def get_project(project_id: str) -> Project:
    return _load(project_id)


@app.put("/projects/{project_id}/lyrics-text")
def update_lyrics_text(project_id: str, body: str = Body(media_type="text/plain")) -> Project:
    with _editing(project_id) as project:
        project.lyrics_text = body
    return project


@app.put("/projects/{project_id}/meta")
def update_meta(project_id: str, meta: Meta) -> Project:
    with _editing(project_id) as project:
        project.meta = meta
    return project


@app.put("/projects/{project_id}/settings")
def update_settings(project_id: str, settings: Settings) -> Project:
    with _editing(project_id) as project:
        project.settings = settings
    return project


@app.put("/projects/{project_id}/section-descriptions")
def update_section_descriptions(project_id: str, descriptions: list[str]) -> Project:
    with _editing(project_id) as project:
        project.section_descriptions = descriptions
    return project


@app.get("/projects/{project_id}/audio")
def get_audio(project_id: str) -> FileResponse:
    return FileResponse(_dir(project_id) / "audio.mp3", media_type="audio/mpeg")


@app.get("/projects/{project_id}/analysis")
def get_analysis(project_id: str) -> AnalysisData:
    analysis = _read(project_id, "analysis.json", AnalysisData)
    if analysis is None:
        raise HTTPException(404, "not analyzed yet")
    return analysis


@app.get("/projects/{project_id}/lyrics")
def get_lyrics(project_id: str) -> Lyrics:
    lyrics = _read(project_id, "lyrics.json", Lyrics)
    if lyrics is None:
        raise HTTPException(404, "not aligned yet")
    return lyrics


@app.put("/projects/{project_id}/lyrics")
def put_lyrics(project_id: str, lyrics: Lyrics) -> Lyrics:
    _write(project_id, "lyrics.json", lyrics)
    return lyrics


@app.get("/projects/{project_id}/lyrics.lrc")
def export_lrc(project_id: str, enhanced: bool = False) -> PlainTextResponse:
    return PlainTextResponse(lrc.serialize(get_lyrics(project_id), enhanced=enhanced))


@app.post("/projects/{project_id}/lyrics/import-lrc")
def import_lrc(project_id: str, body: str = Body(media_type="text/plain")) -> Lyrics:
    _dir(project_id)
    return put_lyrics(project_id, lrc.parse(body))


def _optional_lyrics(project_id: str) -> Lyrics | None:
    return _read(project_id, "lyrics.json", Lyrics)


def _optional_plan(project_id: str) -> StylePlan | None:
    return _read(project_id, "style_plan.json", StylePlan)


def _optional_storyboard(project_id: str) -> Storyboard | None:
    return _read(project_id, "storyboard.json", Storyboard)


def _load_plan(project_id: str) -> StylePlan:
    plan = _optional_plan(project_id)
    if plan is None:
        raise HTTPException(404, "no style plan yet")
    return plan


def _analysis_or_409(project_id: str) -> AnalysisData:
    try:
        return get_analysis(project_id)
    except HTTPException:
        raise HTTPException(409, "run analysis first") from None


@app.post("/projects/{project_id}/style-plan")
def create_style_plan(project_id: str, client: anthropic.Anthropic = Depends(claude_client)) -> StylePlan:
    project = _load(project_id)
    analysis = _analysis_or_409(project_id)
    with claude_errors("style plan generation"):
        plan = generate_plan(project, analysis, _optional_lyrics(project_id), client)
    _write(project_id, "style_plan.json", plan, by_alias=True)
    return plan


@app.get("/projects/{project_id}/style-plan", response_model_by_alias=True)
def get_style_plan(project_id: str) -> StylePlan:
    return _load_plan(project_id)


@app.put("/projects/{project_id}/style-plan", response_model_by_alias=True)
def put_style_plan(project_id: str, plan: StylePlan) -> StylePlan:
    _dir(project_id)
    _write(project_id, "style_plan.json", plan, by_alias=True)
    return plan


@app.post("/projects/{project_id}/style-plan/sections/{index}/regenerate")
def regenerate_style_section(project_id: str, index: int, client: anthropic.Anthropic = Depends(claude_client)) -> StyleSection:
    project = _load(project_id)
    analysis = _analysis_or_409(project_id)
    plan = _load_plan(project_id)
    if not 0 <= index < min(len(plan.sections), len(analysis.sections)):
        raise HTTPException(404, "no such section")
    with claude_errors("section regeneration"):
        section = regenerate_section(project, analysis, _optional_lyrics(project_id), plan, index, client)
    plan.sections[index] = section
    _write(project_id, "style_plan.json", plan, by_alias=True)
    return section


@app.get("/projects/{project_id}/storyboard")
def get_storyboard(project_id: str) -> Storyboard:
    board = _optional_storyboard(project_id)
    if board is None:
        raise HTTPException(404, "no storyboard yet")
    return board


@app.put("/projects/{project_id}/storyboard")
def put_storyboard(project_id: str, board: Storyboard) -> Storyboard:
    _dir(project_id)
    try:
        n_sections = len(get_analysis(project_id).sections)
    except HTTPException:
        n_sections = None  # not analyzed yet; section refs are checked once there are sections
    problems = board.validate_refs(n_sections if n_sections is not None else 10**6)
    if problems:
        raise HTTPException(422, "; ".join(problems))
    with illustrate.board_lock:
        _write(project_id, "storyboard.json", board)
    return board


@app.post("/projects/{project_id}/storyboard/generate")
def create_storyboard(project_id: str, client: anthropic.Anthropic = Depends(claude_client)) -> Storyboard:
    project = _load(project_id)
    analysis = _analysis_or_409(project_id)
    with claude_errors("storyboard generation"):
        existing = _optional_storyboard(project_id)
        board = generate_storyboard(
            project,
            analysis,
            _optional_lyrics(project_id),
            _optional_plan(project_id),
            client,
            illustration=existing.illustration if existing else "library",
            objects=existing.objects if existing else [],
        )
    with illustrate.board_lock:
        _write(project_id, "storyboard.json", board)
    return board


@app.post("/projects/{project_id}/storyboard/scenes/{index}/regenerate")
def regenerate_storyboard_scene(project_id: str, index: int, client: anthropic.Anthropic = Depends(claude_client)) -> Scene:
    project = _load(project_id)
    analysis = _analysis_or_409(project_id)
    board = _optional_storyboard(project_id)
    if board is None:
        raise HTTPException(409, "generate a storyboard first")
    if not 0 <= index < len(analysis.sections):
        raise HTTPException(404, "no such section")
    with claude_errors("scene regeneration"):
        scene = regenerate_scene(project, analysis, _optional_lyrics(project_id), _optional_plan(project_id), board, index, client)
    with illustrate.board_lock:
        board = _optional_storyboard(project_id) or board  # pick up edits (or new art) made while Claude was thinking
        board.scenes = [s for s in board.scenes if s.section_ref != index] + [scene]
        board.scenes.sort(key=lambda s: s.section_ref)
        _write(project_id, "storyboard.json", board)
    return scene


@app.post("/projects/{project_id}/render", status_code=202)
def start_render(project_id: str, seconds: float | None = Query(None, gt=0, le=3600)) -> RenderStatus:
    """Renders the MP4 in the background; `seconds` renders only that many seconds from the start."""
    project = _load(project_id)
    analysis = _analysis_or_409(project_id)
    props = render.build_props(project, analysis, _optional_lyrics(project_id), _optional_plan(project_id), _optional_storyboard(project_id))
    try:
        job = render.start(project_id, _dir(project_id) / "out", props, seconds)
    except render.RenderBusy as e:
        raise HTTPException(409, str(e)) from e
    return job.status()


@app.get("/projects/{project_id}/render")
def render_status(project_id: str) -> RenderStatus:
    _dir(project_id)
    job = render.latest(project_id)
    if job is None:
        raise HTTPException(404, "no render started")
    return job.status()


@app.get("/projects/{project_id}/render/video")
def render_video(project_id: str, clip: bool = False) -> FileResponse:
    path = _dir(project_id) / "out" / ("preview.mp4" if clip else "video.mp4")
    if not path.exists():
        raise HTTPException(404, "not rendered yet")
    title = _load(project_id).meta.title.strip() or project_id
    safe = "".join(c for c in title if c.isalnum() or c in " -_").strip() or project_id
    return FileResponse(path, media_type="video/mp4", filename=f"{safe}{' (preview)' if clip else ''}.mp4")


@app.post("/projects/{project_id}/process", status_code=202)
def start_process(project_id: str) -> ProcessStatus:
    """Analyzes the audio and, if there are lyrics and lyric video is on, separates vocals and aligns them."""
    project = _load(project_id)
    d = _dir(project_id)
    try:
        job = jobs.start(project_id, lambda j: pipeline.run(d, project, j))
    except jobs.Busy as e:
        raise HTTPException(409, str(e)) from e
    return job.status()


@app.get("/projects/{project_id}/process")
def process_status(project_id: str) -> ProcessStatus:
    _dir(project_id)
    job = jobs.JOBS.get((project_id, "process"))
    if job is None:
        raise HTTPException(404, "no processing started")
    return job.status()


@app.post("/projects/{project_id}/storyboard/illustrate", status_code=202)
def start_illustration(
    project_id: str,
    scene: list[int] = Query(default=[]),
    character: list[str] = Query(default=[]),
    obj: list[str] = Query(default=[], alias="object"),
    client: anthropic.Anthropic = Depends(claude_client),
) -> ProcessStatus:
    """Draws free-form art. With no parameters, draws whatever is missing for free-form scenes; `scene` / `character` / `object`
    redraw those specific assets."""
    project = _load(project_id)
    d = _dir(project_id)
    board = _optional_storyboard(project_id)
    if board is None:
        raise HTTPException(409, "generate a storyboard first")
    scenes, characters, objects = set(scene) or None, set(character) or None, set(obj) or None
    if not illustrate.plan_tasks(board, scenes, characters, objects):
        raise HTTPException(422, "nothing to draw: no free-form scenes or custom objects need art (or the chosen assets don't exist)")
    plan = _optional_plan(project_id)
    try:
        job = jobs.start(project_id, lambda j: illustrate.run(d, project, plan, scenes, characters, objects, j, client), kind="illustrate")
    except jobs.Busy as e:
        raise HTTPException(409, str(e)) from e
    return job.status()


@app.get("/projects/{project_id}/storyboard/illustrate")
def illustration_status(project_id: str) -> ProcessStatus:
    _dir(project_id)
    job = jobs.JOBS.get((project_id, "illustrate"))
    if job is None:
        raise HTTPException(404, "no drawing started")
    return job.status()
