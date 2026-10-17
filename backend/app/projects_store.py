"""Where projects live: a registry of id -> folder, plus the single-file .mvm bundle (a zip of the project's files)."""

import json
import os
import re
import shutil
import tempfile
import uuid
import zipfile
import zlib
from pathlib import Path

from pydantic import ValidationError

from app.models import Project

REGISTRY = ".registry.json"
MANIFEST = "manifest.json"
# The only names a bundle may contain or extract; anything else (renders, paths with "..") is ignored.
PROJECT_FILES = ("project.json", "audio.mp3", "analysis.json", "lyrics.json", "style_plan.json", "storyboard.json", "vocals.wav")


class BundleError(ValueError):
    pass


def write_atomic(path: Path, data: str | bytes) -> None:
    """Writes through a temp file in the same folder, so an interrupted write never leaves a truncated file behind."""
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex[:8]}.tmp")
    try:
        tmp.write_bytes(data.encode() if isinstance(data, str) else data)
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def slug(text: str, fallback: str = "project") -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or fallback


def registry(root: Path) -> dict[str, str]:
    try:
        return json.loads((root / REGISTRY).read_text())
    except (OSError, ValueError):
        return {}


def register(root: Path, project_id: str, path: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    entries = registry(root)
    entries[project_id] = str(path)
    write_atomic(root / REGISTRY, json.dumps(entries, indent=1))


def unregister(root: Path, project_id: str) -> None:
    entries = registry(root)
    if entries.pop(project_id, None) is not None:
        write_atomic(root / REGISTRY, json.dumps(entries, indent=1))


def resolve(root: Path, project_id: str) -> Path:
    """Registered folder if there is one, else the default location under root."""
    registered = registry(root).get(project_id)
    return Path(registered) if registered else root / project_id


def known_ids(root: Path) -> list[str]:
    ids = dict.fromkeys(registry(root))
    if root.is_dir():
        for d in root.iterdir():
            if not d.name.startswith(".") and (d / "project.json").is_file():  # dot-folders are imports being unpacked
                ids.setdefault(d.name)
    return list(ids)


def project_folder(parent: Path, title: str, project_id: str) -> Path:
    return parent / f"{slug(title)}-{project_id}"


def _rewrite_id(folder: Path, project_id: str) -> None:
    meta = json.loads((folder / "project.json").read_text())
    meta["id"] = project_id
    write_atomic(folder / "project.json", json.dumps(meta, indent=2))


def copy_project(src: Path, dest: Path, project_id: str) -> None:
    """Copies the project's files (not renders) into a new folder, under a new id."""
    dest.mkdir(parents=True)
    for name in PROJECT_FILES:
        if (src / name).is_file():
            shutil.copy2(src / name, dest / name)
    _rewrite_id(dest, project_id)


def write_bundle(src: Path, out: Path) -> None:
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(MANIFEST, json.dumps({"format": "mvm", "version": 1}))
        for name in PROJECT_FILES:
            if (src / name).is_file():
                z.write(src / name, name)


def read_bundle(bundle: Path, dest: Path, project_id: str) -> None:
    """Extracts a .mvm into dest (which must not exist yet) under a new id. Nothing is left behind if it fails."""
    if dest.exists():
        raise BundleError(f"{dest} already exists")
    try:
        with zipfile.ZipFile(bundle) as z:
            names = set(z.namelist())
            try:
                manifest = json.loads(z.read(MANIFEST))
            except (KeyError, ValueError) as e:
                raise BundleError("missing or unreadable manifest") from e
            if not isinstance(manifest, dict) or manifest.get("format") != "mvm" or manifest.get("version") != 1:
                raise BundleError("unsupported .mvm version")
            if "project.json" not in names:
                raise BundleError("bundle has no project.json")
            try:
                project = Project.model_validate_json(z.read("project.json"))
            except ValidationError as e:
                raise BundleError(f"project.json is not a valid project ({e.error_count()} problems)") from e
            project.id = project_id
            dest.parent.mkdir(parents=True, exist_ok=True)
            # Unpacked beside dest and renamed into place, so a half-extracted bundle never looks like a project.
            staging = Path(tempfile.mkdtemp(dir=dest.parent, prefix=".import-"))
            try:
                for name in PROJECT_FILES:
                    if name in names and name != "project.json":
                        with z.open(name) as f, open(staging / name, "wb") as out:
                            shutil.copyfileobj(f, out)
                (staging / "project.json").write_text(project.model_dump_json(indent=2))
                staging.rename(dest)
            except BaseException:
                shutil.rmtree(staging, ignore_errors=True)
                raise
    except BundleError:
        raise
    except (zipfile.BadZipFile, zlib.error, EOFError, NotImplementedError, RuntimeError) as e:
        raise BundleError(f"not a readable .mvm file: {e}") from e
    except OSError as e:
        raise BundleError(f"could not unpack the bundle: {e}") from e
