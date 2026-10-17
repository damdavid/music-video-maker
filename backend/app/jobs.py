"""Background jobs for the analyze + align pipeline, sharing one "only one heavy job at a time" rule with rendering."""

import threading
from collections.abc import Callable
from dataclasses import dataclass

from app.models import ProcessStatus

lock = threading.Lock()
_busy_checks: list[Callable[[], bool]] = []


class Busy(RuntimeError):
    pass


def register_busy_check(check: Callable[[], bool]) -> None:
    _busy_checks.append(check)


def any_active() -> bool:
    return any(check() for check in _busy_checks)


@dataclass
class ProcessJob:
    project_id: str
    kind: str = "process"
    state: str = "queued"
    stage: str = "queued"
    progress: float = 0.0
    error: str | None = None

    @property
    def active(self) -> bool:
        return self.state in ("queued", "running")

    def report(self, stage: str, progress: float) -> None:
        self.state, self.stage = "running", stage
        self.progress = max(self.progress, min(progress, 0.999))  # never run backwards; 1.0 is reserved for done

    def status(self) -> ProcessStatus:
        return ProcessStatus(state=self.state, stage=self.stage, progress=self.progress, error=self.error)


JOBS: dict[tuple[str, str], ProcessJob] = {}  # keyed by (project id, kind): a project can have one of each
register_busy_check(lambda: any(j.active for j in JOBS.values()))


def _run(job: ProcessJob, work: Callable[[ProcessJob], str | None]) -> None:
    try:
        summary = work(job)
        job.state, job.stage, job.progress = "done", summary or "done", 1.0
    except Exception as e:  # surfaced through the status endpoint instead of dying in the thread
        job.state, job.error = "error", f"{type(e).__name__}: {e}"


def start(project_id: str, work: Callable[[ProcessJob], str | None], kind: str = "process") -> ProcessJob:
    """`work` may return a short summary that becomes the job's final stage text."""
    with lock:
        if any_active():
            raise Busy("another job is in progress")
        job = ProcessJob(project_id=project_id, kind=kind)
        JOBS[(project_id, kind)] = job
    threading.Thread(target=_run, args=(job, work), daemon=True).start()
    return job
