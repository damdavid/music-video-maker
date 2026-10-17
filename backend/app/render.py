"""Runs video/render.mjs (Remotion) as a background job and tracks its progress."""

import json
import os
import shutil
import subprocess
import threading
from dataclasses import dataclass
from pathlib import Path

from app import jobs
from app.models import AnalysisData, Lyrics, Project, RenderStatus, Storyboard, StylePlan

VIDEO_DIR = Path(__file__).resolve().parents[2] / "video"
# Headless Chrome fetches the audio from here, so it must be the backend's own address, not the Vite proxy's.
BACKEND_URL = os.environ.get("MUSIC_VIDEO_MAKER_BACKEND_URL", "http://127.0.0.1:8000")
ERROR_TAIL_LINES = 12


class RenderBusy(RuntimeError):
    pass


@dataclass
class RenderJob:
    project_id: str
    output: Path
    clip: bool
    state: str = "queued"
    progress: float = 0.0
    error: str | None = None
    width: int | None = None
    height: int | None = None
    fps: int | None = None

    @property
    def active(self) -> bool:
        return self.state not in ("done", "error")

    def status(self) -> RenderStatus:
        return RenderStatus(
            state=self.state, progress=self.progress, clip=self.clip, error=self.error, width=self.width, height=self.height, fps=self.fps
        )


JOBS: dict[str, RenderJob] = {}
jobs.register_busy_check(lambda: any(j.active for j in JOBS.values()))


def build_props(
    project: Project, analysis: AnalysisData, lyrics: Lyrics | None, plan: StylePlan | None, storyboard: Storyboard | None = None
) -> dict:
    return {
        "analysis": analysis.model_dump(),
        "lyrics": lyrics.model_dump() if lyrics and project.settings.lyric_video else None,
        "plan": plan.model_dump(by_alias=True) if plan else None,
        "meta": project.meta.model_dump(),
        "storyboard": storyboard.model_dump() if storyboard else None,
        "settings": project.settings.model_dump(),
        "audioSrc": f"{BACKEND_URL}/projects/{project.id}/audio",
    }


def render_command(props_path: Path, out: Path, seconds: float | None) -> list[str]:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node is not on PATH; it is required to render video")
    cmd = [node, str(VIDEO_DIR / "render.mjs"), "--props", str(props_path), "--out", str(out)]
    return cmd + ["--seconds", str(seconds)] if seconds else cmd


def _apply(job: RenderJob, event: dict) -> None:
    if event.get("type") == "stage":
        job.state = event["stage"]
        job.progress = max(job.progress, min(float(event["progress"]), 0.999))
    elif event.get("type") == "done":
        job.state, job.progress = "done", 1.0
        job.width, job.height, job.fps = event.get("width"), event.get("height"), event.get("fps")
    elif event.get("type") == "error":
        job.state, job.error = "error", event.get("message", "render failed")


def _run(job: RenderJob, props: dict, seconds: float | None) -> None:
    out_dir = job.output.parent
    props_path = out_dir / f".props-{job.output.stem}.json"
    log_path = out_dir / "render.log"
    proc: subprocess.Popen | None = None
    try:
        props_path.write_text(json.dumps(props))
        with log_path.open("w") as log:
            proc = subprocess.Popen(
                render_command(props_path, job.output, seconds), cwd=VIDEO_DIR, stdout=subprocess.PIPE, stderr=log, text=True
            )
            assert proc.stdout is not None
            for line in proc.stdout:
                try:
                    event = json.loads(line)
                    if isinstance(event, dict):
                        _apply(job, event)
                except (KeyError, TypeError, ValueError):
                    continue  # stray non-protocol output
            code = proc.wait()
        if job.state != "done" and job.error is None:
            tail = "\n".join(log_path.read_text().splitlines()[-ERROR_TAIL_LINES:])
            job.state, job.error = "error", f"renderer exited with code {code}" + (f": {tail}" if tail else "")
        elif job.state == "done" and not job.output.exists():
            job.state, job.error = "error", "renderer reported success but wrote no file"
    except Exception as e:  # keep the job inspectable rather than dying silently in the thread
        job.state, job.error = "error", f"{type(e).__name__}: {e}"
    finally:
        if proc is not None and proc.poll() is None:
            proc.kill()
            proc.wait()
        props_path.unlink(missing_ok=True)


def start(project_id: str, out_dir: Path, props: dict, seconds: float | None) -> RenderJob:
    with jobs.lock:
        if jobs.any_active():
            raise RenderBusy("another job is in progress")  # renders and the analysis pipeline each saturate the CPU
        out_dir.mkdir(exist_ok=True)
        clip = seconds is not None
        job = RenderJob(project_id=project_id, output=out_dir / ("preview.mp4" if clip else "video.mp4"), clip=clip)
        job.output.unlink(missing_ok=True)
        JOBS[project_id] = job
    threading.Thread(target=_run, args=(job, props, seconds), daemon=True).start()
    return job


def latest(project_id: str) -> RenderJob | None:
    return JOBS.get(project_id)


